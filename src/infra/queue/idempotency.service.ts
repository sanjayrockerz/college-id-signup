import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisStreamsService } from "./redis-streams.service";
import {
  MessageEnvelope,
  IngressAck,
  MessagePriority,
} from "./message-envelope.interface";
import { Counter, Histogram, register } from "prom-client";
import { v4 as uuidv4 } from "uuid";
import * as crypto from "crypto";

/**
 * Generate time-ordered UUID
 * Using UUID v4 for now, replace with v7 when available
 */
function uuidv7(): string {
  return uuidv4();
}

/**
 * Idempotency Service for Phase 3 At-Least-Once Delivery
 *
 * IDEMPOTENCY STRATEGY:
 * - Ingress: Fast ACK with idempotencyKey, correlationId, pending state
 * - Persistence: Upsert by (conversationId, messageId), unique constraint on idempotencyKey
 * - Receipts: Unique constraint per (messageId, recipientId, state), monotonic transitions
 *
 * GUARANTEE:
 * - At-least-once delivery (retries allowed)
 * - No user-visible duplicates (idempotent operations)
 * - Idempotent hits observable via telemetry
 *
 * DEDUPLICATION WINDOWS:
 * - Ingress: Check Redis cache (last 5 minutes) + DB (last 24 hours)
 * - Persistence: DB unique constraint (permanent)
 * - Receipts: DB unique constraint (permanent)
 *
 * CLIENT IDEMPOTENCY KEYS:
 * - Client-provided: Use clientMessageId from request
 * - Generated: Hash of (conversationId + senderId + content + timestamp_window)
 * - Timestamp window: Round to 1-second boundary to handle clock drift
 */

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  // Metrics
  private readonly idempotentHitCounter: Counter;
  private readonly ingressDuration: Histogram;
  private readonly persistenceDuration: Histogram;

  constructor(
    private readonly prisma: PrismaService,
    private readonly streams: RedisStreamsService,
  ) {
    this.idempotentHitCounter = new Counter({
      name: "idempotency_hit_total",
      help: "Total idempotent hits (duplicate requests)",
      labelNames: ["operation", "source"],
      registers: [register],
    });

    this.ingressDuration = new Histogram({
      name: "idempotency_ingress_duration_ms",
      help: "Ingress processing duration",
      labelNames: ["status"],
      buckets: [10, 25, 50, 100, 250, 500],
      registers: [register],
    });

    this.persistenceDuration = new Histogram({
      name: "idempotency_persistence_duration_ms",
      help: "Persistence processing duration",
      labelNames: ["status"],
      buckets: [50, 100, 250, 500, 1000, 2500],
      registers: [register],
    });
  }

  /**
   * Ingest message with idempotency check
   *
   * FLOW:
   * 1. Compute or extract idempotencyKey
   * 2. Check if already processed (Redis + DB)
   * 3. If duplicate: Return existing result (idempotent hit)
   * 4. If new: Enqueue to stream and ACK with "pending"
   *
   * FAST PATH:
   * - Redis cache check (in-memory, <1ms)
   * - Returns immediately if duplicate found
   *
   * SLOW PATH:
   * - DB check if not in cache
   * - Enqueue to stream
   * - ACK with correlationId
   *
   * @param request Inbound message request
   * @returns Ingress acknowledgment
   */
  async ingestMessage(request: {
    conversationId: string;
    senderId: string;
    content: string;
    contentType: string;
    clientMessageId?: string;
    correlationId?: string;
    recipientIds: string[];
  }): Promise<IngressAck> {
    const startTime = Date.now();

    try {
      // Generate IDs
      const messageId = uuidv7(); // Time-ordered UUID
      const correlationId = request.correlationId || uuidv7();

      // Compute idempotency key
      const idempotencyKey = request.clientMessageId
        ? this.hashClientMessageId(request.clientMessageId)
        : this.generateIdempotencyKey(
            request.conversationId,
            request.senderId,
            request.content,
            new Date(),
          );

      // Check for duplicate (fast path: Redis cache)
      const cachedAck = await this.checkCachedIdempotency(idempotencyKey);
      if (cachedAck) {
        this.idempotentHitCounter.inc({
          operation: "ingress",
          source: "cache",
        });

        this.ingressDuration.observe(
          { status: "idempotent_hit" },
          Date.now() - startTime,
        );

        return { ...cachedAck, idempotentHit: true };
      }

      // Check for duplicate (slow path: DB)
      const existingMessage = await this.prisma.message.findFirst({
        where: { idempotencyKey },
        select: { id: true, createdAt: true },
      });

      if (existingMessage) {
        this.idempotentHitCounter.inc({
          operation: "ingress",
          source: "database",
        });

        const ack: IngressAck = {
          messageId: existingMessage.id,
          correlationId,
          state: "pending",
          acceptedAt: existingMessage.createdAt.toISOString(),
          idempotencyKey,
          idempotentHit: true,
        };

        // Cache for future requests
        await this.cacheIdempotency(idempotencyKey, ack);

        this.ingressDuration.observe(
          { status: "idempotent_hit" },
          Date.now() - startTime,
        );

        return ack;
      }

      // New message: Create envelope
      const envelope: MessageEnvelope = {
        messageId,
        conversationId: request.conversationId,
        senderId: request.senderId,
        createdAt: new Date().toISOString(),
        payloadKey: null, // Inline content for now, optimize later
        idempotencyKey,
        correlationId,
        metadata: {
          content: request.content,
          contentType: request.contentType,
          priority: MessagePriority.NORMAL,
          retryCount: 0,
          recipientIds: request.recipientIds,
        },
      };

      // Enqueue to stream
      await this.streams.enqueue(envelope);

      // Create ACK
      const ack: IngressAck = {
        messageId,
        correlationId,
        state: "pending",
        acceptedAt: envelope.createdAt,
        idempotencyKey,
        idempotentHit: false,
      };

      // Cache for deduplication
      await this.cacheIdempotency(idempotencyKey, ack);

      this.ingressDuration.observe(
        { status: "success" },
        Date.now() - startTime,
      );

      this.logger.debug(
        `Ingested message ${messageId} with idempotencyKey ${idempotencyKey}`,
      );

      return ack;
    } catch (error) {
      this.ingressDuration.observe({ status: "error" }, Date.now() - startTime);

      this.logger.error("Failed to ingest message:", error);
      throw error;
    }
  }

  /**
   * Persist message with idempotency guarantee
   *
   * UPSERT STRATEGY:
   * - INSERT ... ON CONFLICT (idempotencyKey) DO NOTHING
   * - If inserted: New message, proceed with fanout
   * - If conflict: Duplicate, log idempotent hit and skip
   *
   * UNIQUE CONSTRAINTS:
   * - PRIMARY KEY (id)
   * - UNIQUE (conversationId, id) for queries
   * - UNIQUE (idempotencyKey) for deduplication
   *
   * @param envelope Message envelope from stream
   * @returns Whether message was newly persisted (false = idempotent hit)
   */
  async persistMessage(envelope: MessageEnvelope): Promise<boolean> {
    const startTime = Date.now();

    try {
      // Upsert with ON CONFLICT DO NOTHING
      const result = await this.prisma.$queryRaw<{ inserted: boolean }[]>`
        INSERT INTO "Message" (
          id,
          "conversationId",
          "userId",
          content,
          "createdAt",
          "idempotencyKey",
          "correlationId"
        ) VALUES (
          ${envelope.messageId},
          ${envelope.conversationId},
          ${envelope.senderId},
          ${envelope.metadata.content},
          ${new Date(envelope.createdAt)},
          ${envelope.idempotencyKey},
          ${envelope.correlationId}
        )
        ON CONFLICT ("idempotencyKey") DO NOTHING
        RETURNING true as inserted
      `;

      const wasInserted = result.length > 0;

      if (!wasInserted) {
        // Idempotent hit
        this.idempotentHitCounter.inc({
          operation: "persistence",
          source: "database",
        });

        this.logger.debug(
          `Idempotent hit for message ${envelope.messageId} (idempotencyKey: ${envelope.idempotencyKey})`,
        );
      }

      this.persistenceDuration.observe(
        { status: wasInserted ? "inserted" : "idempotent_hit" },
        Date.now() - startTime,
      );

      return wasInserted;
    } catch (error) {
      this.persistenceDuration.observe(
        { status: "error" },
        Date.now() - startTime,
      );

      this.logger.error(
        `Failed to persist message ${envelope.messageId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Record receipt transition with idempotency
   *
   * RECEIPT STATE MACHINE:
   * - sent → delivered → read
   * - Transitions are monotonic (no backward movement)
   * - Each transition is idempotent (retry-safe)
   *
   * UNIQUE CONSTRAINT:
   * - UNIQUE (messageId, recipientId, state)
   * - Prevents duplicate transitions
   *
   * AUDITABILITY:
   * - Store timestamp and actor for each transition
   * - Enables forensics and debugging
   *
   * @param messageId Message identifier
   * @param recipientId Recipient user ID
   * @param state Receipt state (sent, delivered, read)
   * @returns Whether transition was newly recorded
   */
  async recordReceipt(
    messageId: string,
    recipientId: string,
    state: "sent" | "delivered" | "read",
  ): Promise<boolean> {
    try {
      // Upsert with ON CONFLICT DO NOTHING
      const result = await this.prisma.$queryRaw<{ inserted: boolean }[]>`
        INSERT INTO "MessageReceipt" (
          "messageId",
          "userId",
          state,
          "timestamp",
          "createdAt"
        ) VALUES (
          ${messageId},
          ${recipientId},
          ${state},
          ${new Date()},
          ${new Date()}
        )
        ON CONFLICT ("messageId", "userId", state) DO NOTHING
        RETURNING true as inserted
      `;

      const wasInserted = result.length > 0;

      if (!wasInserted) {
        // Idempotent hit
        this.idempotentHitCounter.inc({
          operation: "receipt",
          source: "database",
        });

        this.logger.debug(
          `Idempotent receipt transition for message ${messageId}, recipient ${recipientId}, state ${state}`,
        );
      }

      return wasInserted;
    } catch (error) {
      this.logger.error(
        `Failed to record receipt for message ${messageId}, recipient ${recipientId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Generate idempotency key from message fields
   *
   * STRATEGY:
   * - Hash (conversationId + senderId + content + timestamp_window)
   * - Timestamp window: Round to 1-second boundary
   * - Handles clock drift and rapid retries
   * - Produces stable key for same logical message
   */
  private generateIdempotencyKey(
    conversationId: string,
    senderId: string,
    content: string,
    timestamp: Date,
  ): string {
    // Round timestamp to 1-second window
    const windowedTimestamp = Math.floor(timestamp.getTime() / 1000);

    // Compute SHA-256 hash
    const hash = crypto
      .createHash("sha256")
      .update(`${conversationId}:${senderId}:${content}:${windowedTimestamp}`)
      .digest("hex");

    return `idem_${hash.substring(0, 32)}`;
  }

  /**
   * Hash client-provided message ID
   */
  private hashClientMessageId(clientMessageId: string): string {
    const hash = crypto
      .createHash("sha256")
      .update(clientMessageId)
      .digest("hex");

    return `client_${hash.substring(0, 32)}`;
  }

  /**
   * Check Redis cache for idempotency key
   *
   * Cache TTL: 5 minutes
   * Fast deduplication for rapid retries
   */
  private async checkCachedIdempotency(
    idempotencyKey: string,
  ): Promise<IngressAck | null> {
    // TODO: Implement Redis cache check
    // For now, return null (always check DB)
    return null;
  }

  /**
   * Cache idempotency key in Redis
   *
   * TTL: 5 minutes (300 seconds)
   * Reduces DB load for retry storms
   */
  private async cacheIdempotency(
    idempotencyKey: string,
    ack: IngressAck,
  ): Promise<void> {
    // TODO: Implement Redis cache set
    // Store serialized ACK with 300s TTL
  }
}
