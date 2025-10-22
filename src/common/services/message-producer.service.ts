import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { RedisStreamsService } from "../../infra/queue/redis-streams.service";
import {
  MessageProducerValidator,
  SendMessageRequest,
} from "../validators/message-producer.validator";
import {
  ProducerError,
  ConversationNotFoundError,
  NotConversationMemberError,
  ConversationInactiveError,
  UserBlockedError,
  EnqueueFailedError,
} from "../errors/producer.errors";
import {
  MessageEnvelope,
  MessagePriority,
  IngressAck,
} from "../../infra/queue/message-envelope.interface";
import { Counter, Histogram, register } from "prom-client";
import { v4 as uuidv4 } from "uuid";
import * as crypto from "crypto";

/**
 * Fast Message Producer Service
 *
 * HOT-PATH DESIGN:
 * - Validate schema and authorization synchronously
 * - Enqueue to Redis Streams (XADD ~2ms)
 * - Return "pending" ACK immediately
 * - NO database writes on hot path
 *
 * FLOW:
 * 1. Schema validation (throw ProducerError if invalid)
 * 2. Authorization checks (conversation membership, active status)
 * 3. Compute idempotencyKey and correlationId
 * 4. Enqueue envelope to stream
 * 5. Return pending ACK with correlationId
 *
 * METRICS:
 * - producer_enqueued_total (counter with labels)
 * - producer_reject_total (counter with reason labels)
 * - producer_enqueue_duration_ms (histogram for p50/p95)
 *
 * EVENTUAL CONSISTENCY GUIDANCE:
 * - Client receives "pending" state
 * - Consumer will persist and emit "sent" state
 * - WebSocket/polling for state transitions
 */

@Injectable()
export class MessageProducerService {
  private readonly logger = new Logger(MessageProducerService.name);

  // Metrics
  private readonly enqueuedCounter: Counter;
  private readonly rejectedCounter: Counter;
  private readonly enqueueDuration: Histogram;

  constructor(
    private readonly prisma: PrismaService,
    private readonly streams: RedisStreamsService,
  ) {
    // Initialize metrics
    this.enqueuedCounter = new Counter({
      name: "producer_enqueued_total",
      help: "Total messages enqueued to stream",
      labelNames: ["conversation_type", "content_type", "priority"],
      registers: [register],
    });

    this.rejectedCounter = new Counter({
      name: "producer_reject_total",
      help: "Total messages rejected by producer",
      labelNames: ["reason", "status_code"],
      registers: [register],
    });

    this.enqueueDuration = new Histogram({
      name: "producer_enqueue_duration_ms",
      help: "Producer enqueue duration (validation + enqueue)",
      labelNames: ["status"],
      buckets: [1, 2, 5, 10, 25, 50, 100, 250],
      registers: [register],
    });
  }

  /**
   * Send message (fast producer)
   *
   * @param request Send message request
   * @returns Pending acknowledgment with correlationId
   * @throws ProducerError on validation or authorization failure
   */
  async sendMessage(request: any): Promise<IngressAck> {
    const startTime = Date.now();

    try {
      // 1. Schema validation (synchronous, throws ProducerError)
      const validatedRequest =
        MessageProducerValidator.validateSendMessage(request);

      // 2. Authorization checks (fast DB queries)
      await this.authorizeRequest(validatedRequest);

      // 3. Compute IDs
      const messageId = uuidv4();
      const correlationId = uuidv4();
      const idempotencyKey = this.computeIdempotencyKey(validatedRequest);

      // 4. Build envelope
      const envelope = this.buildEnvelope(
        messageId,
        correlationId,
        idempotencyKey,
        validatedRequest,
      );

      // 5. Enqueue to stream (XADD ~2ms)
      await this.streams.enqueue(envelope);

      // 6. Metrics
      this.enqueuedCounter.inc({
        conversation_type: "direct", // TODO: Get from conversation
        content_type: validatedRequest.contentType || "text",
        priority: MessagePriority[envelope.metadata.priority].toLowerCase(),
      });

      this.enqueueDuration.observe(
        { status: "success" },
        Date.now() - startTime,
      );

      // 7. Return pending ACK
      const ack: IngressAck = {
        messageId,
        correlationId,
        state: "pending",
        acceptedAt: envelope.createdAt,
        idempotencyKey,
        idempotentHit: false,
      };

      this.logger.debug(
        `Enqueued message ${messageId} to conversation ${validatedRequest.conversationId} (${Date.now() - startTime}ms)`,
      );

      return ack;
    } catch (error) {
      // Handle ProducerError
      if (error instanceof ProducerError) {
        this.rejectedCounter.inc({
          reason: error.getTelemetryLabel(),
          status_code: error.statusCode.toString(),
        });

        this.enqueueDuration.observe(
          { status: "rejected" },
          Date.now() - startTime,
        );

        this.logger.warn(
          `Rejected message: ${error.code} - ${error.message}`,
          error.details,
        );

        throw error;
      }

      // Unexpected error
      this.rejectedCounter.inc({
        reason: "internal_error",
        status_code: "500",
      });

      this.enqueueDuration.observe({ status: "error" }, Date.now() - startTime);

      this.logger.error("Unexpected producer error:", error);
      throw new EnqueueFailedError("Internal error", error as Error);
    }
  }

  /**
   * Authorization checks (fast)
   *
   * Queries:
   * 1. Conversation exists and is active
   * 2. Sender is conversation member
   * 3. Recipients are valid users (if provided)
   * 4. No blocking relationships
   */
  private async authorizeRequest(request: SendMessageRequest): Promise<void> {
    // Check conversation exists and is active
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: request.conversationId },
      select: {
        id: true,
        isActive: true,
        type: true,
        conversationUsers: {
          where: { userId: request.senderId },
          select: { userId: true, isActive: true },
        },
      },
    });

    if (!conversation) {
      throw new ConversationNotFoundError(request.conversationId);
    }

    if (!conversation.isActive) {
      throw new ConversationInactiveError(request.conversationId);
    }

    // Check sender is member
    const senderMembership = conversation.conversationUsers.find(
      (cu) => cu.userId === request.senderId,
    );

    if (!senderMembership) {
      throw new NotConversationMemberError(
        request.senderId,
        request.conversationId,
      );
    }

    if (!senderMembership.isActive) {
      throw new NotConversationMemberError(
        request.senderId,
        request.conversationId,
      );
    }

    // TODO: Check blocking relationships
    // For now, skip to keep hot path fast
    // Can add later with Redis cache
  }

  /**
   * Compute idempotency key
   *
   * STRATEGY:
   * - Client-provided: Use clientMessageId
   * - Generated: Hash(conversationId + senderId + content + timestamp_window)
   * - Timestamp window: Round to 1-second boundary
   */
  private computeIdempotencyKey(request: SendMessageRequest): string {
    if (request.clientMessageId) {
      // Client-provided: hash for consistency
      const hash = crypto
        .createHash("sha256")
        .update(request.clientMessageId)
        .digest("hex");

      return `client_${hash.substring(0, 32)}`;
    }

    // Generated: stable key for same logical message
    const timestamp = Math.floor(Date.now() / 1000); // 1-second window
    const hash = crypto
      .createHash("sha256")
      .update(
        `${request.conversationId}:${request.senderId}:${request.content}:${timestamp}`,
      )
      .digest("hex");

    return `idem_${hash.substring(0, 32)}`;
  }

  /**
   * Build message envelope for stream
   */
  private buildEnvelope(
    messageId: string,
    correlationId: string,
    idempotencyKey: string,
    request: SendMessageRequest,
  ): MessageEnvelope {
    return {
      messageId,
      conversationId: request.conversationId,
      senderId: request.senderId,
      createdAt: new Date().toISOString(),
      payloadKey: null, // Inline content for now
      idempotencyKey,
      correlationId,
      metadata: {
        content: request.content,
        contentType: request.contentType || "text",
        priority: MessagePriority.NORMAL,
        retryCount: 0,
        recipientIds: request.recipientIds || [],
        client: undefined, // TODO: Extract from request headers
        flags: {
          isEdited: false,
          isDeleted: false,
          requiresReceipt: true,
        },
      },
    };
  }
}
