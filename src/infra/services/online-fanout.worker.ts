import { Injectable, Logger } from "@nestjs/common";
import { MessageEnvelope } from "../queue/message-envelope.interface";
import { Counter, register } from "prom-client";
import { PresenceRegistryService } from "./presence-registry.service";
import { SocketEmitterService } from "./socket-emitter.service";

/**
 * Delivery Pipeline: Online Fanout Worker via Redis Registry
 *
 * RESPONSIBILITIES:
 * 1. Resolve recipient users
 * 2. Check online status via Redis registry
 * 3. Emit message to online users via targeted WebSocket
 * 4. Track success/failure per recipient
 *
 * REDIS REGISTRY:
 * - Key: user:{userId}:online → Set of socketIds
 * - Presence heartbeat every 30s
 * - TTL: 60s (auto-cleanup on disconnect)
 *
 * FANOUT STRATEGY:
 * - For each online recipient:
 *   1. Get socketIds from Redis
 *   2. Emit to all sockets (multi-device support)
 *   3. Track delivery success/failure
 *
 * METRICS:
 * - delivery_fanout_attempted_total (per recipient)
 * - delivery_fanout_delivered_total (success)
 * - delivery_fanout_failed_total (failure with reason)
 *
 * ISOLATION:
 * - Fanout failures don't block persistence
 * - Offline users handled separately (push queue)
 */

export interface OnlineRecipient {
  userId: string;
  socketIds: string[];
}

export interface FanoutResult {
  recipientId: string;
  delivered: boolean;
  socketCount: number;
  reason?: string;
}

@Injectable()
export class OnlineFanoutWorker {
  private readonly logger = new Logger(OnlineFanoutWorker.name);

  // Metrics
  private readonly fanoutAttemptedCounter: Counter;
  private readonly fanoutDeliveredCounter: Counter;
  private readonly fanoutFailedCounter: Counter;

  constructor(
    private readonly presenceRegistry: PresenceRegistryService,
    private readonly socketEmitter: SocketEmitterService,
  ) {
    this.fanoutAttemptedCounter = new Counter({
      name: "delivery_fanout_attempted_total",
      help: "Total fanout attempts",
      labelNames: ["recipient_status"],
      registers: [register],
    });

    this.fanoutDeliveredCounter = new Counter({
      name: "delivery_fanout_delivered_total",
      help: "Total successful fanout deliveries",
      labelNames: ["socket_count"],
      registers: [register],
    });

    this.fanoutFailedCounter = new Counter({
      name: "delivery_fanout_failed_total",
      help: "Total failed fanout deliveries",
      labelNames: ["reason"],
      registers: [register],
    });
  }

  /**
   * Fan out message to online recipients
   *
   * @param envelope Message envelope
   * @returns Fanout results per recipient
   */
  async fanoutToOnlineUsers(
    envelope: MessageEnvelope,
  ): Promise<FanoutResult[]> {
    const results: FanoutResult[] = [];

    // Get recipient IDs
    const recipientIds = envelope.metadata.recipientIds || [];

    if (recipientIds.length === 0) {
      this.logger.debug(
        `No recipients for message ${envelope.messageId}, skipping fanout`,
      );
      return results;
    }

    // Check online status and get socket IDs
    const onlineRecipients = await this.getOnlineRecipients(recipientIds);

    this.logger.debug(
      `Message ${envelope.messageId}: ${onlineRecipients.length}/${recipientIds.length} recipients online`,
    );

    // Emit to online recipients
    for (const recipient of onlineRecipients) {
      const result = await this.emitToRecipient(envelope, recipient);
      results.push(result);
    }

    // Track offline recipients (will be handled by push queue)
    const offlineRecipientIds = recipientIds.filter(
      (id) => !onlineRecipients.some((r) => r.userId === id),
    );

    for (const recipientId of offlineRecipientIds) {
      results.push({
        recipientId,
        delivered: false,
        socketCount: 0,
        reason: "offline",
      });

      this.fanoutAttemptedCounter.inc({ recipient_status: "offline" });
    }

    return results;
  }

  /**
   * Get online recipients from Redis registry
   *
   * Redis Keys:
   * - user:{userId}:online → Set<socketId>
   *
   * @param recipientIds List of recipient user IDs
   * @returns Online recipients with their socket IDs
   */
  private async getOnlineRecipients(
    recipientIds: string[],
  ): Promise<OnlineRecipient[]> {
    const records =
      await this.presenceRegistry.getOnlineRecipients(recipientIds);
    return records.map((record) => ({
      userId: record.userId,
      socketIds: record.socketIds,
    }));
  }

  /**
   * Emit message to recipient's sockets
   *
   * WebSocket Event:
   * {
   *   event: "message.new",
   *   data: {
   *     messageId: string,
   *     conversationId: string,
   *     senderId: string,
   *     content: string,
   *     createdAt: ISO timestamp,
   *     correlationId: string,
   *     state: "sent"
   *   }
   * }
   *
   * @param envelope Message envelope
   * @param recipient Online recipient
   * @returns Fanout result
   */
  private async emitToRecipient(
    envelope: MessageEnvelope,
    recipient: OnlineRecipient,
  ): Promise<FanoutResult> {
    try {
      const payload = {
        event: "message.new",
        data: {
          messageId: envelope.messageId,
          conversationId: envelope.conversationId,
          senderId: envelope.senderId,
          content: envelope.metadata.content,
          contentType: envelope.metadata.contentType,
          createdAt: envelope.createdAt,
          correlationId: envelope.correlationId,
          state: "sent",
          metadata: {
            replyToId: envelope.metadata.flags?.replyToId,
            threadId: envelope.metadata.flags?.threadId,
          },
        },
      };

      await this.socketEmitter.emitToSockets(
        recipient.socketIds,
        payload.event,
        payload.data,
      );

      this.logger.debug(
        `Emit message ${envelope.messageId} to user ${recipient.userId} (${recipient.socketIds.length} sockets)`,
      );

      this.fanoutAttemptedCounter.inc({ recipient_status: "online" });
      this.fanoutDeliveredCounter.inc({
        socket_count: recipient.socketIds.length.toString(),
      });

      return {
        recipientId: recipient.userId,
        delivered: true,
        socketCount: recipient.socketIds.length,
      };
    } catch (error) {
      this.logger.error(
        `Failed to emit message ${envelope.messageId} to user ${recipient.userId}:`,
        error,
      );

      this.fanoutFailedCounter.inc({ reason: "emit_error" });

      return {
        recipientId: recipient.userId,
        delivered: false,
        socketCount: recipient.socketIds.length,
        reason: "emit_error",
      };
    }
  }
}
