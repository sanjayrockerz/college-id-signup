import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { RedisStreamsService } from "../queue/redis-streams.service";
import { MessageEnvelope } from "../queue/message-envelope.interface";
import { MessagePersistenceWorker } from "./message-persistence.worker";
import { OnlineFanoutWorker, FanoutResult } from "./online-fanout.worker";
import { PushNotificationWorker } from "./push-notification.worker";
import { Counter, Histogram, register } from "prom-client";

/**
 * Delivery Pipeline Consumer
 *
 * ORCHESTRATION:
 * 1. Dequeue message from stream (XREADGROUP)
 * 2. Persist message (idempotent)
 * 3. Fanout to online users (Redis registry + WebSocket)
 * 4. Schedule push for offline users (separate queue)
 * 5. ACK message to stream
 *
 * SAFETY:
 * - Idempotent persistence (safe to replay)
 * - Graceful crash recovery (resume from offset)
 * - DLQ for permanent failures
 * - Isolated failures (push doesn't block core delivery)
 *
 * METRICS:
 * - delivery_pipeline_processed_total (success/fail)
 * - delivery_pipeline_duration_ms (p50/p95)
 * - delivery_pipeline_step_duration_ms (per step)
 *
 * CONSUMER LIFECYCLE:
 * - OnModuleInit: Start consumer workers (one per partition)
 * - OnModuleDestroy: Graceful shutdown (finish pending, then stop)
 */

@Injectable()
export class DeliveryPipelineConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeliveryPipelineConsumer.name);

  private readonly totalPartitions: number;
  private readonly consumerName: string;
  private readonly maxRetries: number;
  private readonly pollInterval: number;
  private readonly batchSize: number;

  private workers: Map<number, DeliveryWorker> = new Map();
  private isShuttingDown = false;

  // Metrics
  private readonly pipelineProcessedCounter: Counter;
  private readonly pipelineDuration: Histogram;
  private readonly stepDuration: Histogram;

  constructor(
    private readonly streams: RedisStreamsService,
    private readonly persistence: MessagePersistenceWorker,
    private readonly onlineFanout: OnlineFanoutWorker,
    private readonly pushNotification: PushNotificationWorker,
  ) {
    this.totalPartitions = parseInt(process.env.STREAM_PARTITIONS || "16", 10);
    this.consumerName = `delivery-${process.pid}-${Date.now()}`;
    this.maxRetries = parseInt(process.env.STREAM_MAX_RETRIES || "3", 10);
    this.pollInterval = parseInt(
      process.env.STREAM_POLL_INTERVAL_MS || "5000",
      10,
    );
    this.batchSize = parseInt(process.env.STREAM_BATCH_SIZE || "10", 10);

    this.pipelineProcessedCounter = new Counter({
      name: "delivery_pipeline_processed_total",
      help: "Total messages processed by delivery pipeline",
      labelNames: ["partition", "status"],
      registers: [register],
    });

    this.pipelineDuration = new Histogram({
      name: "delivery_pipeline_duration_ms",
      help: "Delivery pipeline processing duration",
      labelNames: ["partition"],
      buckets: [50, 100, 250, 500, 1000, 2500, 5000],
      registers: [register],
    });

    this.stepDuration = new Histogram({
      name: "delivery_pipeline_step_duration_ms",
      help: "Delivery pipeline step duration",
      labelNames: ["step"],
      buckets: [10, 25, 50, 100, 250, 500, 1000],
      registers: [register],
    });
  }

  /**
   * Initialize delivery workers for all partitions
   */
  async onModuleInit(): Promise<void> {
    this.logger.log(
      `Starting ${this.totalPartitions} delivery workers (consumer: ${this.consumerName})`,
    );

    for (let partition = 0; partition < this.totalPartitions; partition++) {
      const worker = new DeliveryWorker(
        partition,
        this.consumerName,
        this.streams,
        this.persistence,
        this.onlineFanout,
        this.pushNotification,
        this.maxRetries,
        this.pollInterval,
        this.batchSize,
        this.pipelineProcessedCounter,
        this.pipelineDuration,
        this.stepDuration,
        this.logger,
      );

      this.workers.set(partition, worker);

      // Start worker (non-blocking)
      worker.start().catch((error) => {
        this.logger.error(
          `Delivery worker for partition ${partition} crashed:`,
          error,
        );
      });
    }

    this.logger.log("All delivery workers started");
  }

  /**
   * Graceful shutdown: stop all workers
   */
  async onModuleDestroy(): Promise<void> {
    this.logger.log("Shutting down delivery workers...");
    this.isShuttingDown = true;

    const shutdownPromises: Promise<void>[] = [];

    for (const [partition, worker] of this.workers.entries()) {
      shutdownPromises.push(
        worker.stop().catch((error) => {
          this.logger.error(
            `Failed to stop delivery worker for partition ${partition}:`,
            error,
          );
        }),
      );
    }

    await Promise.all(shutdownPromises);
    this.logger.log("All delivery workers stopped");
  }
}

/**
 * Delivery Worker for single partition
 *
 * PROCESSING LOOP:
 * 1. Dequeue batch from stream
 * 2. For each message:
 *    a. Persist to database (idempotent)
 *    b. Fanout to online users
 *    c. Schedule push for offline users
 * 3. ACK successful messages
 * 4. Retry or DLQ failed messages
 */
class DeliveryWorker {
  private isRunning = false;

  constructor(
    private readonly partition: number,
    private readonly consumerName: string,
    private readonly streams: RedisStreamsService,
    private readonly persistence: MessagePersistenceWorker,
    private readonly onlineFanout: OnlineFanoutWorker,
    private readonly pushNotification: PushNotificationWorker,
    private readonly maxRetries: number,
    private readonly pollInterval: number,
    private readonly batchSize: number,
    private readonly pipelineProcessedCounter: Counter,
    private readonly pipelineDuration: Histogram,
    private readonly stepDuration: Histogram,
    private readonly logger: Logger,
  ) {}

  /**
   * Start worker loop
   */
  async start(): Promise<void> {
    this.isRunning = true;
    this.logger.debug(
      `Delivery worker started for partition ${this.partition}`,
    );

    while (this.isRunning) {
      try {
        await this.poll();
      } catch (error) {
        this.logger.error(
          `Error in delivery worker loop for partition ${this.partition}:`,
          error,
        );

        // Brief pause before retry to avoid tight error loop
        await this.sleep(1000);
      }
    }

    this.logger.debug(
      `Delivery worker stopped for partition ${this.partition}`,
    );
  }

  /**
   * Stop worker loop
   */
  async stop(): Promise<void> {
    this.isRunning = false;
  }

  /**
   * Poll and process batch
   */
  private async poll(): Promise<void> {
    // Dequeue batch (long-poll with block)
    const messages = await this.streams.dequeue(
      this.partition,
      this.consumerName,
      this.batchSize,
      this.pollInterval,
    );

    if (messages.length === 0) {
      // No messages, loop will re-poll
      return;
    }

    this.logger.debug(
      `Dequeued ${messages.length} messages from partition ${this.partition}`,
    );

    // Process each message
    const successes: string[] = [];
    const failures: Array<{
      streamId: string;
      envelope: MessageEnvelope;
      error: any;
    }> = [];

    for (const [streamId, envelope] of messages) {
      const result = await this.processMessage(envelope);

      if (result.success) {
        successes.push(streamId);
      } else {
        failures.push({ streamId, envelope, error: result.error });
      }
    }

    // ACK successful messages
    if (successes.length > 0) {
      await this.streams.acknowledge(this.partition, successes);
      this.logger.debug(
        `ACK'd ${successes.length} messages from partition ${this.partition}`,
      );
    }

    // Handle failures
    for (const { streamId, envelope, error } of failures) {
      await this.handleFailure(streamId, envelope, error);
    }
  }

  /**
   * Process single message through delivery pipeline
   *
   * STEPS:
   * 1. Persist (idempotent)
   * 2. Fanout to online users
   * 3. Schedule push for offline users
   *
   * @param envelope Message envelope
   * @returns Success status
   */
  private async processMessage(envelope: MessageEnvelope): Promise<{
    success: boolean;
    error?: any;
  }> {
    const startTime = Date.now();

    try {
      // Step 1: Persist message (idempotent)
      const persistStart = Date.now();
      const persistResult = await this.persistence.persistMessage(envelope);
      this.stepDuration.observe({ step: "persist" }, Date.now() - persistStart);

      if (!persistResult.success) {
        throw new Error("Persistence failed");
      }

      // Skip fanout/push if idempotent hit (already processed)
      if (persistResult.idempotentHit) {
        this.logger.debug(
          `Idempotent hit for message ${envelope.messageId}, skipping fanout/push`,
        );

        this.pipelineProcessedCounter.inc({
          partition: this.partition.toString(),
          status: "idempotent_hit",
        });

        this.pipelineDuration.observe(
          { partition: this.partition.toString() },
          Date.now() - startTime,
        );

        return { success: true };
      }

      // Step 2: Fanout to online users
      const fanoutStart = Date.now();
      const fanoutResults =
        await this.onlineFanout.fanoutToOnlineUsers(envelope);
      this.stepDuration.observe({ step: "fanout" }, Date.now() - fanoutStart);

      // Collect offline recipients
      const offlineRecipientIds = fanoutResults
        .filter((r) => !r.delivered && r.reason === "offline")
        .map((r) => r.recipientId);

      // Step 3: Schedule push for offline users
      if (offlineRecipientIds.length > 0) {
        const pushStart = Date.now();
        await this.pushNotification.schedulePushNotifications(
          envelope,
          offlineRecipientIds,
        );
        this.stepDuration.observe(
          { step: "push_schedule" },
          Date.now() - pushStart,
        );
      }

      // Success
      this.pipelineProcessedCounter.inc({
        partition: this.partition.toString(),
        status: "success",
      });

      this.pipelineDuration.observe(
        { partition: this.partition.toString() },
        Date.now() - startTime,
      );

      this.logger.debug(
        `Processed message ${envelope.messageId}: persist=${persistResult.success}, fanout=${fanoutResults.length}, push=${offlineRecipientIds.length} (${Date.now() - startTime}ms)`,
      );

      return { success: true };
    } catch (error) {
      this.pipelineProcessedCounter.inc({
        partition: this.partition.toString(),
        status: "error",
      });

      this.logger.error(
        `Failed to process message ${envelope.messageId}:`,
        error,
      );

      return { success: false, error };
    }
  }

  /**
   * Handle failed message
   *
   * RETRY STRATEGY:
   * - Increment retryCount
   * - If < maxRetries: Leave in pending (consumer group will redeliver)
   * - If >= maxRetries: Send to DLQ and ACK
   */
  private async handleFailure(
    streamId: string,
    envelope: MessageEnvelope,
    error: any,
  ): Promise<void> {
    const retryCount = envelope.metadata.retryCount || 0;

    if (retryCount >= this.maxRetries) {
      // Max retries exceeded, send to DLQ
      this.logger.warn(
        `Sending message ${envelope.messageId} to DLQ after ${retryCount} retries`,
      );

      await this.streams.sendToDeadLetter(
        this.partition,
        streamId,
        envelope,
        "max_retries_exceeded",
        error,
      );

      // ACK to remove from pending
      await this.streams.acknowledge(this.partition, [streamId]);
    } else {
      // Will be redelivered by consumer group
      this.logger.debug(
        `Message ${envelope.messageId} will be retried (attempt ${retryCount + 1}/${this.maxRetries})`,
      );

      // Increment retry count for next attempt
      envelope.metadata.retryCount = retryCount + 1;

      // Note: Not ACK'ing leaves message in pending state
      // Redis consumer group will redeliver after idle timeout
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
