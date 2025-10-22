import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { RedisStreamsService } from "./redis-streams.service";
import { IdempotencyService } from "./idempotency.service";
import { MessageEnvelope } from "./message-envelope.interface";
import { Counter, Histogram, register } from "prom-client";

/**
 * Stream Consumer Worker for Phase 3 At-Least-Once Delivery
 *
 * ARCHITECTURE:
 * - One worker per partition for in-order processing
 * - Long-polling dequeue (XREADGROUP with BLOCK)
 * - Persist to database via idempotent service
 * - ACK after successful persistence
 * - Send to DLQ after max retries (default: 3)
 *
 * ORDERING GUARANTEE:
 * - Single consumer per partition ensures FIFO within conversation
 * - Partitioning by conversationId ensures same conversation → same partition
 * - Cross-conversation parallelism via multiple partitions
 *
 * ERROR HANDLING:
 * - Transient errors: Retry with exponential backoff
 * - Permanent errors: Send to DLQ after max attempts
 * - Consumer crash: Redis consumer group tracks pending messages
 * - Restart: Resume from last checkpoint
 *
 * MONITORING:
 * - Processing duration (p50, p95, p99)
 * - Success/failure counters
 * - DLQ send rate
 * - Consumer lag per partition
 */

@Injectable()
export class StreamConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StreamConsumerService.name);

  private readonly totalPartitions: number;
  private readonly consumerName: string;
  private readonly maxRetries: number;
  private readonly pollInterval: number;
  private readonly batchSize: number;

  private workers: Map<number, Worker> = new Map();
  private isShuttingDown = false;

  // Metrics
  private readonly processingCounter: Counter;
  private readonly processingDuration: Histogram;
  private readonly dlqCounter: Counter;

  constructor(
    private readonly streams: RedisStreamsService,
    private readonly idempotency: IdempotencyService,
  ) {
    this.totalPartitions = parseInt(process.env.STREAM_PARTITIONS || "16", 10);
    this.consumerName = `consumer-${process.pid}-${Date.now()}`;
    this.maxRetries = parseInt(process.env.STREAM_MAX_RETRIES || "3", 10);
    this.pollInterval = parseInt(
      process.env.STREAM_POLL_INTERVAL_MS || "5000",
      10,
    );
    this.batchSize = parseInt(process.env.STREAM_BATCH_SIZE || "10", 10);

    this.processingCounter = new Counter({
      name: "stream_consumer_processed_total",
      help: "Total messages processed by consumer",
      labelNames: ["partition", "status"],
      registers: [register],
    });

    this.processingDuration = new Histogram({
      name: "stream_consumer_processing_duration_ms",
      help: "Message processing duration",
      labelNames: ["partition"],
      buckets: [50, 100, 250, 500, 1000, 2500, 5000],
      registers: [register],
    });

    this.dlqCounter = new Counter({
      name: "stream_consumer_dlq_total",
      help: "Total messages sent to DLQ",
      labelNames: ["partition", "reason"],
      registers: [register],
    });
  }

  /**
   * Initialize consumer workers for all partitions
   */
  async onModuleInit(): Promise<void> {
    this.logger.log(
      `Starting ${this.totalPartitions} consumer workers (consumer: ${this.consumerName})`,
    );

    for (let partition = 0; partition < this.totalPartitions; partition++) {
      const worker = new Worker(
        partition,
        this.consumerName,
        this.streams,
        this.idempotency,
        this.maxRetries,
        this.pollInterval,
        this.batchSize,
        this.processingCounter,
        this.processingDuration,
        this.dlqCounter,
        this.logger,
      );

      this.workers.set(partition, worker);

      // Start worker (non-blocking)
      worker.start().catch((error) => {
        this.logger.error(`Worker for partition ${partition} crashed:`, error);
      });
    }

    this.logger.log("All consumer workers started");
  }

  /**
   * Graceful shutdown: stop all workers
   */
  async onModuleDestroy(): Promise<void> {
    this.logger.log("Shutting down consumer workers...");
    this.isShuttingDown = true;

    const shutdownPromises: Promise<void>[] = [];

    for (const [partition, worker] of this.workers.entries()) {
      shutdownPromises.push(
        worker.stop().catch((error) => {
          this.logger.error(
            `Failed to stop worker for partition ${partition}:`,
            error,
          );
        }),
      );
    }

    await Promise.all(shutdownPromises);
    this.logger.log("All consumer workers stopped");
  }
}

/**
 * Worker for single partition
 *
 * Processes messages in a tight loop:
 * 1. Dequeue batch from stream (long-poll)
 * 2. Process each message (persist to DB)
 * 3. ACK successful messages
 * 4. Retry failed messages
 * 5. Send to DLQ after max retries
 */
class Worker {
  private isRunning = false;

  constructor(
    private readonly partition: number,
    private readonly consumerName: string,
    private readonly streams: RedisStreamsService,
    private readonly idempotency: IdempotencyService,
    private readonly maxRetries: number,
    private readonly pollInterval: number,
    private readonly batchSize: number,
    private readonly processingCounter: Counter,
    private readonly processingDuration: Histogram,
    private readonly dlqCounter: Counter,
    private readonly logger: Logger,
  ) {}

  /**
   * Start worker loop
   */
  async start(): Promise<void> {
    this.isRunning = true;
    this.logger.debug(`Worker started for partition ${this.partition}`);

    while (this.isRunning) {
      try {
        await this.poll();
      } catch (error) {
        this.logger.error(
          `Error in worker loop for partition ${this.partition}:`,
          error,
        );

        // Brief pause before retry to avoid tight error loop
        await this.sleep(1000);
      }
    }

    this.logger.debug(`Worker stopped for partition ${this.partition}`);
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
      const startTime = Date.now();

      try {
        // Persist message (idempotent)
        const wasInserted = await this.idempotency.persistMessage(envelope);

        if (wasInserted) {
          this.logger.debug(
            `Persisted message ${envelope.messageId} from partition ${this.partition}`,
          );
        } else {
          this.logger.debug(
            `Idempotent hit for message ${envelope.messageId} (skipped persistence)`,
          );
        }

        // Track success
        successes.push(streamId);

        this.processingCounter.inc({
          partition: this.partition.toString(),
          status: "success",
        });

        this.processingDuration.observe(
          { partition: this.partition.toString() },
          Date.now() - startTime,
        );
      } catch (error) {
        this.logger.error(
          `Failed to process message ${envelope.messageId}:`,
          error,
        );

        failures.push({ streamId, envelope, error });

        this.processingCounter.inc({
          partition: this.partition.toString(),
          status: "error",
        });
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

      this.dlqCounter.inc({
        partition: this.partition.toString(),
        reason: "max_retries",
      });
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
