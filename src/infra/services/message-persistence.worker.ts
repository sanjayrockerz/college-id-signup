import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { MessageEnvelope } from "../queue/message-envelope.interface";
import { Counter, Histogram, register } from "prom-client";
import { CacheService } from "../../common/services/cache.service";

/**
 * Delivery Pipeline: Idempotent Persistence Worker
 *
 * RESPONSIBILITIES:
 * 1. Persist message to database (INSERT ON CONFLICT DO NOTHING)
 * 2. Emit "sent" state transition
 * 3. Invalidate caches (recent messages, conversation metadata)
 * 4. Return success/failure for consumer ACK decision
 *
 * IDEMPOTENCY:
 * - Unique constraint on idempotencyKey
 * - Upsert by (conversationId, messageId)
 * - Safe to replay on consumer restart
 *
 * CACHE INVALIDATION:
 * - Recent messages cache per conversation
 * - Conversation lastMessageAt metadata
 * - User unread count cache
 *
 * METRICS:
 * - delivery_persist_total (success/fail)
 * - delivery_persist_duration_ms (p50/p95)
 * - delivery_cache_invalidated_total
 */

@Injectable()
export class MessagePersistenceWorker {
  private readonly logger = new Logger(MessagePersistenceWorker.name);

  // Metrics
  private readonly persistCounter: Counter;
  private readonly persistDuration: Histogram;
  private readonly cacheInvalidatedCounter: Counter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {
    this.persistCounter = new Counter({
      name: "delivery_persist_total",
      help: "Total message persistence attempts",
      labelNames: ["status", "idempotent_hit"],
      registers: [register],
    });

    this.persistDuration = new Histogram({
      name: "delivery_persist_duration_ms",
      help: "Message persistence duration",
      labelNames: ["status"],
      buckets: [10, 25, 50, 100, 250, 500, 1000],
      registers: [register],
    });

    this.cacheInvalidatedCounter = new Counter({
      name: "delivery_cache_invalidated_total",
      help: "Total cache invalidations",
      labelNames: ["cache_type"],
      registers: [register],
    });
  }

  /**
   * Persist message with idempotency
   *
   * @param envelope Message envelope from stream
   * @returns Success status and whether it was idempotent hit
   */
  async persistMessage(envelope: MessageEnvelope): Promise<{
    success: boolean;
    idempotentHit: boolean;
  }> {
    const startTime = Date.now();

    try {
      // 1. Upsert message (INSERT ON CONFLICT DO NOTHING)
      const result = await this.prisma.$queryRaw<{ inserted: boolean }[]>`
        INSERT INTO "Message" (
          id,
          "conversationId",
          "senderId",
          content,
          type,
          status,
          "createdAt",
          "idempotencyKey",
          "correlationId",
          "replyToId",
          "threadId"
        ) VALUES (
          ${envelope.messageId},
          ${envelope.conversationId},
          ${envelope.senderId},
          ${envelope.metadata.content},
          ${envelope.metadata.contentType?.toUpperCase() || "TEXT"},
          'SENT',
          ${new Date(envelope.createdAt)},
          ${envelope.idempotencyKey},
          ${envelope.correlationId},
          ${envelope.metadata.flags?.replyToId || null},
          ${envelope.metadata.flags?.threadId || null}
        )
        ON CONFLICT ("idempotencyKey") DO NOTHING
        RETURNING true as inserted
      `;

      const wasInserted = result.length > 0;

      if (!wasInserted) {
        // Idempotent hit - message already persisted
        this.persistCounter.inc({
          status: "success",
          idempotent_hit: "true",
        });

        this.persistDuration.observe(
          { status: "idempotent_hit" },
          Date.now() - startTime,
        );

        this.logger.debug(
          `Idempotent hit for message ${envelope.messageId} (idempotencyKey: ${envelope.idempotencyKey})`,
        );

        return { success: true, idempotentHit: true };
      }

      // 2. Update conversation metadata
      await this.updateConversationMetadata(
        envelope.conversationId,
        envelope.messageId,
        new Date(envelope.createdAt),
      );

      // 3. Invalidate caches
      await this.invalidateCaches(envelope);

      // 4. Metrics
      this.persistCounter.inc({
        status: "success",
        idempotent_hit: "false",
      });

      this.persistDuration.observe(
        { status: "success" },
        Date.now() - startTime,
      );

      this.logger.debug(
        `Persisted message ${envelope.messageId} to conversation ${envelope.conversationId} (${Date.now() - startTime}ms)`,
      );

      return { success: true, idempotentHit: false };
    } catch (error) {
      this.persistCounter.inc({
        status: "error",
        idempotent_hit: "false",
      });

      this.persistDuration.observe({ status: "error" }, Date.now() - startTime);

      this.logger.error(
        `Failed to persist message ${envelope.messageId}:`,
        error,
      );

      return { success: false, idempotentHit: false };
    }
  }

  /**
   * Update conversation metadata after message persistence
   */
  private async updateConversationMetadata(
    conversationId: string,
    messageId: string,
    timestamp: Date,
  ): Promise<void> {
    try {
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: timestamp,
          lastMessageId: messageId,
          updatedAt: timestamp,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to update conversation metadata for ${conversationId}:`,
        error,
      );
      // Non-fatal: conversation metadata is eventually consistent
    }
  }

  /**
   * Invalidate caches after message persistence
   *
   * CACHES TO INVALIDATE:
   * 1. Recent messages cache (conversation:{id}:recent)
   * 2. Conversation metadata cache
   * 3. Unread count cache per user
   */
  private async invalidateCaches(envelope: MessageEnvelope): Promise<void> {
    const cacheKeys = [
      `conversation:${envelope.conversationId}:recent`,
      `conversation:${envelope.conversationId}:metadata`,
      ...envelope.metadata.recipientIds.map((id) => `user:${id}:unread_count`),
    ];

    try {
      await this.cache.delete(cacheKeys);
      this.logger.debug(
        `Cache invalidated for message ${envelope.messageId}:`,
        cacheKeys,
      );
    } catch (error) {
      this.logger.warn(
        `Cache invalidation failed for message ${envelope.messageId}`,
        error,
      );
    }

    this.cacheInvalidatedCounter.inc({ cache_type: "recent_messages" }, 1);

    this.cacheInvalidatedCounter.inc(
      { cache_type: "conversation_metadata" },
      1,
    );

    this.cacheInvalidatedCounter.inc(
      { cache_type: "unread_count" },
      envelope.metadata.recipientIds.length,
    );
  }
}
