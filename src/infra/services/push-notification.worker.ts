import { Injectable, Logger } from "@nestjs/common";
import { MessageEnvelope } from "../queue/message-envelope.interface";
import { Counter, register } from "prom-client";
import { PushQueueService } from "./push-queue.service";
import { PushTokenStore } from "./push-token.store";
import { PushDeliveryService } from "./push-delivery.service";
import { PushTask } from "./push-task.interface";

/**
 * Delivery Pipeline: Push Notification Queue Worker
 *
 * RESPONSIBILITIES:
 * 1. Enqueue push notification tasks for offline users
 * 2. Isolate slow external dependencies (FCM, APNS) from core delivery
 * 3. Implement backoff policies for retry
 * 4. Track push task success/failure
 *
 * SEPARATE QUEUE:
 * - Stream: "push:notifications"
 * - Partitions: 4 (lower than main queue, push is slower)
 * - Consumer group: "push-workers"
 *
 * ISOLATION STRATEGY:
 * - Message is "sent" even if push fails
 * - Push is best-effort notification
 * - Retry with exponential backoff (1s, 5s, 30s)
 * - Max retries: 3
 * - DLQ for permanent failures
 *
 * PUSH TASK ENVELOPE defined in PushTask interface
 *
 * METRICS:
 * - delivery_push_enqueued_total
 * - delivery_push_sent_total (success)
 * - delivery_push_failed_total (with reason)
 */

@Injectable()
export class PushNotificationWorker {
  private readonly logger = new Logger(PushNotificationWorker.name);

  // Metrics
  private readonly pushEnqueuedCounter: Counter;
  private readonly pushSentCounter: Counter;
  private readonly pushFailedCounter: Counter;

  constructor(
    private readonly pushQueue: PushQueueService,
    private readonly tokenStore: PushTokenStore,
    private readonly pushDelivery: PushDeliveryService,
  ) {
    this.pushEnqueuedCounter = new Counter({
      name: "delivery_push_enqueued_total",
      help: "Total push tasks enqueued",
      labelNames: ["reason"],
      registers: [register],
    });

    this.pushSentCounter = new Counter({
      name: "delivery_push_sent_total",
      help: "Total push notifications sent successfully",
      labelNames: ["platform"],
      registers: [register],
    });

    this.pushFailedCounter = new Counter({
      name: "delivery_push_failed_total",
      help: "Total push notification failures",
      labelNames: ["reason"],
      registers: [register],
    });
  }

  /**
   * Schedule push notifications for offline recipients
   *
   * @param envelope Message envelope
   * @param offlineRecipientIds User IDs of offline recipients
   */
  async schedulePushNotifications(
    envelope: MessageEnvelope,
    offlineRecipientIds: string[],
  ): Promise<void> {
    if (offlineRecipientIds.length === 0) {
      return;
    }

    this.logger.debug(
      `Scheduling ${offlineRecipientIds.length} push notifications for message ${envelope.messageId}`,
    );

    // Create push tasks for each offline recipient
    for (const userId of offlineRecipientIds) {
      await this.enqueuePushTask(envelope, userId);
    }
  }

  /**
   * Enqueue push task to separate queue
   *
   * @param envelope Message envelope
   * @param userId Offline recipient user ID
   */
  private async enqueuePushTask(
    envelope: MessageEnvelope,
    userId: string,
  ): Promise<void> {
    try {
      const task: PushTask = {
        taskId: `push_${envelope.messageId}_${userId}`,
        userId,
        messageId: envelope.messageId,
        conversationId: envelope.conversationId,
        senderId: envelope.senderId,
        senderName: envelope.senderId,
        contentPreview: this.generateContentPreview(
          envelope.metadata.content || "",
        ),
        createdAt: envelope.createdAt,
        retryCount: 0,
      };

      await this.pushQueue.enqueue(task);

      this.logger.debug(
        `Enqueued push task for user ${userId}, message ${envelope.messageId}`,
      );

      this.pushEnqueuedCounter.inc({ reason: "offline" });
    } catch (error) {
      this.logger.error(
        `Failed to enqueue push task for user ${userId}:`,
        error,
      );

      this.pushFailedCounter.inc({ reason: "enqueue_error" });
    }
  }

  /**
   * Generate content preview for push notification
   *
   * @param content Full message content
   * @returns Preview (first 100 chars)
   */
  private generateContentPreview(content: string): string {
    const maxLength = 100;
    if (content.length <= maxLength) {
      return content;
    }

    return content.substring(0, maxLength) + "...";
  }

  /**
   * Process push task (called by consumer)
   *
   * @param task Push task
   * @returns Success status
   */
  async processPushTask(task: PushTask): Promise<boolean> {
    try {
      // Check backoff
      if (task.backoffUntil) {
        const backoffTime = new Date(task.backoffUntil).getTime();
        if (Date.now() < backoffTime) {
          this.logger.debug(
            `Task ${task.taskId} is in backoff until ${task.backoffUntil}`,
          );
          return false; // Will be retried later
        }
      }

      const deviceTokens = await this.tokenStore.getTokens(task.userId);
      if (deviceTokens.length === 0) {
        this.logger.debug(
          `No device tokens registered for user ${task.userId}, skipping push`,
        );
        return true;
      }

      const fcmTokens = deviceTokens
        .filter((record) => record.platform === "fcm")
        .map((record) => record.token);

      if (fcmTokens.length === 0) {
        this.logger.debug(
          `No FCM tokens available for user ${task.userId}, skipping push`,
        );
        return true;
      }

      const response = await this.pushDelivery.sendNotification({
        tokens: fcmTokens,
        title: task.senderName,
        body: task.contentPreview,
        data: {
          messageId: task.messageId,
          conversationId: task.conversationId,
          senderId: task.senderId,
          taskId: task.taskId,
        },
      });

      if (response.success) {
        this.pushSentCounter.inc({ platform: "fcm" });
        return true;
      }

      this.pushFailedCounter.inc({ reason: "send_error" });
      return false;
    } catch (error) {
      this.logger.error(
        `Failed to send push notification for task ${task.taskId}:`,
        error,
      );

      this.pushFailedCounter.inc({ reason: "send_error" });

      return false;
    }
  }

  /**
   * Calculate backoff duration for retry
   *
   * Exponential backoff: 1s, 5s, 30s
   *
   * @param retryCount Current retry count
   * @returns Backoff duration in milliseconds
   */
  calculateBackoff(retryCount: number): number {
    const backoffs = [1000, 5000, 30000]; // 1s, 5s, 30s
    return backoffs[Math.min(retryCount, backoffs.length - 1)];
  }
}
