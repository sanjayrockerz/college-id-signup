import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import Redis from "ioredis";
import { MessageEnvelope, PartitionKey } from "./message-envelope.interface";
import { register, Counter, Histogram, Gauge } from "prom-client";
import * as crypto from "crypto";

/**
 * Redis Streams Service for Phase 3 Durable Delivery
 *
 * ARCHITECTURE:
 * - Partitioned streams: Multiple stream keys for parallelism
 * - Consumer groups: Single consumer per partition for order preservation
 * - At-least-once delivery: Messages ACKed after successful persistence
 * - Offset tracking: Per-consumer offset for lag monitoring
 *
 * REDIS STREAMS PRIMER:
 * - XADD: Append message to stream (returns auto-generated ID)
 * - XREADGROUP: Read messages as consumer group (blocks until available)
 * - XACK: Acknowledge processed messages
 * - XPENDING: Check unacknowledged messages
 * - XGROUP CREATE: Create consumer group with offset
 *
 * PARTITIONING STRATEGY:
 * - Hash conversationId to determine partition
 * - Each partition = separate Redis Stream
 * - Single consumer per partition = in-order processing
 * - Parallelism across partitions, order within partition
 *
 * MIGRATION PATH TO KAFKA:
 * - When throughput exceeds 50k msgs/sec
 * - When retention needs exceed 7 days
 * - When multi-datacenter replication required
 * - When stream size per partition exceeds 10GB
 */

@Injectable()
export class RedisStreamsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisStreamsService.name);
  private redis: Redis;
  private readonly totalPartitions: number;
  private readonly streamPrefix = "msg:stream";
  private readonly deadLetterStream = "msg:dlq";

  // Metrics
  private readonly enqueueCounter: Counter;
  private readonly dequeueCounter: Counter;
  private readonly lagGauge: Gauge;
  private readonly processingDuration: Histogram;
  private readonly deadLetterCounter: Counter;
  private readonly idempotentHitCounter: Counter;

  constructor() {
    // Configuration from environment
    this.totalPartitions = parseInt(process.env.STREAM_PARTITIONS || "16", 10);

    this.redis = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379", 10),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_STREAM_DB || "1", 10),
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
    });

    // Initialize metrics
    this.enqueueCounter = new Counter({
      name: "stream_enqueue_total",
      help: "Total messages enqueued to streams",
      labelNames: ["partition", "priority"],
      registers: [register],
    });

    this.dequeueCounter = new Counter({
      name: "stream_dequeue_total",
      help: "Total messages dequeued from streams",
      labelNames: ["partition", "consumer_group"],
      registers: [register],
    });

    this.lagGauge = new Gauge({
      name: "stream_partition_lag",
      help: "Number of pending messages per partition",
      labelNames: ["partition", "consumer_group"],
      registers: [register],
    });

    this.processingDuration = new Histogram({
      name: "stream_processing_duration_ms",
      help: "Message processing duration in milliseconds",
      labelNames: ["partition", "consumer_group", "status"],
      buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000],
      registers: [register],
    });

    this.deadLetterCounter = new Counter({
      name: "stream_dead_letter_total",
      help: "Total messages sent to dead letter queue",
      labelNames: ["partition", "reason"],
      registers: [register],
    });

    this.idempotentHitCounter = new Counter({
      name: "stream_idempotent_hit_total",
      help: "Total idempotent hits (duplicate messages rejected)",
      labelNames: ["partition"],
      registers: [register],
    });
  }

  async onModuleInit() {
    await this.initializeStreams();
    this.logger.log(
      `Redis Streams initialized with ${this.totalPartitions} partitions`,
    );
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }

  /**
   * Initialize stream partitions and consumer groups
   */
  private async initializeStreams(): Promise<void> {
    for (let partition = 0; partition < this.totalPartitions; partition++) {
      const streamKey = this.getStreamKey(partition);

      try {
        // Create consumer group (idempotent - fails if already exists)
        await this.redis.xgroup(
          "CREATE",
          streamKey,
          "persistence-workers",
          "0",
          "MKSTREAM",
        );
        this.logger.log(`Created consumer group for ${streamKey}`);
      } catch (error: any) {
        if (!error.message.includes("BUSYGROUP")) {
          this.logger.error(
            `Failed to create consumer group for ${streamKey}:`,
            error,
          );
        }
      }
    }

    // Initialize dead letter stream
    try {
      await this.redis.xgroup(
        "CREATE",
        this.deadLetterStream,
        "dlq-processors",
        "0",
        "MKSTREAM",
      );
    } catch (error: any) {
      if (!error.message.includes("BUSYGROUP")) {
        this.logger.error("Failed to create DLQ consumer group:", error);
      }
    }
  }

  /**
   * Enqueue message envelope to appropriate partition
   *
   * PARTITIONING:
   * - Hash conversationId using murmur3 (fast, good distribution)
   * - Modulo by totalPartitions to get partition number
   * - All messages in same conversation go to same partition
   * - Preserves ordering within conversation
   *
   * REDIS STREAMS XADD:
   * - Auto-generates ID: "{timestamp_ms}-{sequence}"
   * - ID is monotonically increasing
   * - Used for ordering and offset tracking
   *
   * @param envelope Message envelope to enqueue
   * @returns Stream ID assigned by Redis
   */
  async enqueue(envelope: MessageEnvelope): Promise<string> {
    const partition = this.getPartition(envelope.conversationId);
    const streamKey = this.getStreamKey(partition);

    try {
      // Serialize envelope to stream entry
      const fields = this.serializeEnvelope(envelope);

      // XADD to stream (auto-generates ID)
      const streamId = await this.redis.xadd(
        streamKey,
        "*", // Auto-generate ID
        ...fields,
      );

      // Update metrics
      this.enqueueCounter.inc({
        partition: partition.toString(),
        priority: envelope.metadata.priority.toString(),
      });

      this.logger.debug(
        `Enqueued message ${envelope.messageId} to partition ${partition} with stream ID ${streamId}`,
      );

      return streamId;
    } catch (error) {
      this.logger.error(
        `Failed to enqueue message ${envelope.messageId} to partition ${partition}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Dequeue messages from partition
   *
   * REDIS STREAMS XREADGROUP:
   * - Reads as consumer group member
   * - Blocks until message available (long polling)
   * - Returns unacknowledged messages first
   * - Then new messages with ID > last read
   *
   * CONSUMER GROUP SEMANTICS:
   * - Each message delivered to only one consumer in group
   * - Unacknowledged messages can be claimed by other consumers
   * - Enables at-least-once delivery with consumer failover
   *
   * @param partition Partition to read from
   * @param consumerName Unique consumer identifier
   * @param count Max messages to read
   * @param blockMs Milliseconds to block (0 = no block)
   * @returns Array of [streamId, envelope] tuples
   */
  async dequeue(
    partition: number,
    consumerName: string,
    count: number = 10,
    blockMs: number = 5000,
  ): Promise<Array<[string, MessageEnvelope]>> {
    const streamKey = this.getStreamKey(partition);
    const consumerGroup = "persistence-workers";

    try {
      // XREADGROUP with block
      const result = await this.redis.xreadgroup(
        "GROUP",
        consumerGroup,
        consumerName,
        "COUNT",
        count,
        "BLOCK",
        blockMs,
        "STREAMS",
        streamKey,
        ">", // Read new messages
      );

      if (!result || result.length === 0) {
        return [];
      }

      // Parse stream entries
      const [, entries] = result[0] as [string, Array<[string, string[]]>];
      const messages: Array<[string, MessageEnvelope]> = [];

      for (const [streamId, fields] of entries) {
        try {
          const envelope = this.deserializeEnvelope(fields);
          messages.push([streamId, envelope]);

          this.dequeueCounter.inc({
            partition: partition.toString(),
            consumer_group: consumerGroup,
          });
        } catch (error) {
          this.logger.error(
            `Failed to deserialize message ${streamId} from partition ${partition}:`,
            error,
          );
          // Skip malformed message
        }
      }

      return messages;
    } catch (error) {
      this.logger.error(
        `Failed to dequeue from partition ${partition}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Acknowledge processed messages
   *
   * XACK removes message from pending list
   * After ACK, message won't be delivered again
   * Must ACK after successful persistence to DB
   */
  async acknowledge(partition: number, streamIds: string[]): Promise<number> {
    const streamKey = this.getStreamKey(partition);
    const consumerGroup = "persistence-workers";

    try {
      const ackCount = await this.redis.xack(
        streamKey,
        consumerGroup,
        ...streamIds,
      );

      this.logger.debug(
        `Acknowledged ${ackCount}/${streamIds.length} messages in partition ${partition}`,
      );

      return ackCount;
    } catch (error) {
      this.logger.error(
        `Failed to acknowledge messages in partition ${partition}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get partition lag (pending messages)
   *
   * XPENDING returns summary of unacknowledged messages
   * Used for monitoring consumer health and backpressure
   */
  async getPartitionLag(partition: number): Promise<number> {
    const streamKey = this.getStreamKey(partition);
    const consumerGroup = "persistence-workers";

    try {
      const pending = await this.redis.xpending(streamKey, consumerGroup);

      if (!pending || pending.length === 0) {
        return 0;
      }

      const lag = parseInt(pending[0] as string, 10) || 0;

      // Update metric
      this.lagGauge.set(
        { partition: partition.toString(), consumer_group: consumerGroup },
        lag,
      );

      return lag;
    } catch (error) {
      this.logger.error(`Failed to get lag for partition ${partition}:`, error);
      return 0;
    }
  }

  /**
   * Send message to dead letter queue
   *
   * Used when message cannot be processed after max retries
   * DLQ has separate consumer group for manual review/reprocessing
   */
  async sendToDeadLetter(
    partition: number,
    streamId: string,
    envelope: MessageEnvelope,
    reason: string,
    error: Error,
  ): Promise<void> {
    try {
      const dlqEntry = {
        envelope: JSON.stringify(envelope),
        reason,
        error_message: error.message,
        error_stack: error.stack || "",
        retry_count: envelope.metadata.retryCount.toString(),
        dead_lettered_at: new Date().toISOString(),
        source_stream: this.getStreamKey(partition),
        source_id: streamId,
      };

      await this.redis.xadd(
        this.deadLetterStream,
        "*",
        ...Object.entries(dlqEntry).flat(),
      );

      this.deadLetterCounter.inc({
        partition: partition.toString(),
        reason,
      });

      this.logger.warn(
        `Message ${envelope.messageId} from partition ${partition} sent to DLQ: ${reason}`,
      );
    } catch (dlqError) {
      this.logger.error(
        `Failed to send message ${envelope.messageId} to DLQ:`,
        dlqError,
      );
    }
  }

  /**
   * Calculate partition for conversationId
   *
   * Uses murmur3 hash for good distribution
   * Consistent hashing ensures same conversation always goes to same partition
   */
  private getPartition(conversationId: string): number {
    const hash = this.murmurHash3(conversationId);
    return hash % this.totalPartitions;
  }

  /**
   * Get stream key for partition
   */
  private getStreamKey(partition: number): string {
    return `${this.streamPrefix}:${partition}`;
  }

  /**
   * Serialize envelope to Redis stream fields
   *
   * Redis Streams store as flat key-value pairs
   * Nested objects must be JSON serialized
   */
  private serializeEnvelope(envelope: MessageEnvelope): string[] {
    return [
      "messageId",
      envelope.messageId,
      "conversationId",
      envelope.conversationId,
      "senderId",
      envelope.senderId,
      "createdAt",
      envelope.createdAt,
      "payloadKey",
      envelope.payloadKey || "",
      "idempotencyKey",
      envelope.idempotencyKey,
      "correlationId",
      envelope.correlationId,
      "metadata",
      JSON.stringify(envelope.metadata),
    ];
  }

  /**
   * Deserialize Redis stream fields to envelope
   */
  private deserializeEnvelope(fields: string[]): MessageEnvelope {
    const fieldMap: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      fieldMap[fields[i]] = fields[i + 1];
    }

    return {
      messageId: fieldMap.messageId,
      conversationId: fieldMap.conversationId,
      senderId: fieldMap.senderId,
      createdAt: fieldMap.createdAt,
      payloadKey: fieldMap.payloadKey || null,
      idempotencyKey: fieldMap.idempotencyKey,
      correlationId: fieldMap.correlationId,
      metadata: JSON.parse(fieldMap.metadata),
    };
  }

  /**
   * Murmur3 hash implementation (32-bit)
   * Fast, good distribution for hash partitioning
   */
  private murmurHash3(key: string): number {
    const data = Buffer.from(key, "utf8");
    const c1 = 0xcc9e2d51;
    const c2 = 0x1b873593;
    const r1 = 15;
    const r2 = 13;
    const m = 5;
    const n = 0xe6546b64;

    let hash = 0;
    const nblocks = Math.floor(data.length / 4);

    // Process 4-byte blocks
    for (let i = 0; i < nblocks; i++) {
      let k = data.readInt32LE(i * 4);
      k = Math.imul(k, c1);
      k = (k << r1) | (k >>> (32 - r1));
      k = Math.imul(k, c2);

      hash ^= k;
      hash = (hash << r2) | (hash >>> (32 - r2));
      hash = Math.imul(hash, m) + n;
    }

    // Process remaining bytes
    let k = 0;
    const remaining = data.length % 4;
    if (remaining >= 3) k ^= data[nblocks * 4 + 2] << 16;
    if (remaining >= 2) k ^= data[nblocks * 4 + 1] << 8;
    if (remaining >= 1) {
      k ^= data[nblocks * 4];
      k = Math.imul(k, c1);
      k = (k << r1) | (k >>> (32 - r1));
      k = Math.imul(k, c2);
      hash ^= k;
    }

    // Finalization
    hash ^= data.length;
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x85ebca6b);
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0xc2b2ae35);
    hash ^= hash >>> 16;

    return Math.abs(hash);
  }

  /**
   * Get stream statistics for monitoring
   */
  async getStreamStats(partition: number): Promise<{
    length: number;
    firstId: string | null;
    lastId: string | null;
    lag: number;
  }> {
    const streamKey = this.getStreamKey(partition);

    try {
      const info = await this.redis.xinfo("STREAM", streamKey);
      const length = parseInt(info[1] as string, 10);
      const firstId = (info[5] as string) || null;
      const lastId = (info[7] as string) || null;
      const lag = await this.getPartitionLag(partition);

      return { length, firstId, lastId, lag };
    } catch (error) {
      this.logger.error(
        `Failed to get stats for partition ${partition}:`,
        error,
      );
      return { length: 0, firstId: null, lastId: null, lag: 0 };
    }
  }
}
