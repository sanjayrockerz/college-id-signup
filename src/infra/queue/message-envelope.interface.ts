/**
 * Phase 3 - Durable Delivery Message Envelope
 *
 * DESIGN PRINCIPLES:
 * - Compact envelope: Keep stream messages small, point to payload in object storage
 * - Idempotency: Every message has unique idempotencyKey for deduplication
 * - Traceability: correlationId for request tracing across distributed systems
 * - Partitioning: conversationId for hash-based partition assignment
 * - Metadata: Minimal routing info, avoid heavy blobs on stream
 *
 * ENVELOPE STRUCTURE:
 * - messageId: Unique message identifier (UUID)
 * - conversationId: For partition assignment and ordering
 * - senderId: Message author
 * - createdAt: ISO timestamp for ordering and TTL
 * - payloadKey: Object storage key (S3/R2) for large content
 * - idempotencyKey: For deduplication (clientMessageId or derived hash)
 * - correlationId: Request trace ID
 * - metadata: Minimal routing/priority info
 */

export interface MessageEnvelope {
  /**
   * Unique message identifier (UUID v7 for time-ordering)
   */
  messageId: string;

  /**
   * Conversation ID for partition assignment
   * Used to hash partition messages for order preservation
   */
  conversationId: string;

  /**
   * User ID of sender
   */
  senderId: string;

  /**
   * ISO 8601 timestamp
   * Used for ordering and TTL calculations
   */
  createdAt: string;

  /**
   * Object storage key for large payloads
   * Format: "messages/{conversationId}/{messageId}.json"
   * If null, content is inline in metadata.content
   */
  payloadKey: string | null;

  /**
   * Idempotency key for deduplication
   * - Client-provided: Use clientMessageId from request
   * - Generated: Hash of (conversationId + senderId + content + timestamp_window)
   */
  idempotencyKey: string;

  /**
   * Correlation ID for distributed tracing
   * Propagated from HTTP headers or generated at ingress
   */
  correlationId: string;

  /**
   * Message metadata for routing and processing
   */
  metadata: MessageMetadata;
}

export interface MessageMetadata {
  /**
   * Inline content for small messages (<1KB)
   * Null if content is in object storage
   */
  content: string | null;

  /**
   * Content type (text, image, file, etc.)
   */
  contentType: string;

  /**
   * Message priority (normal, high, urgent)
   * Used for processing order within partition
   */
  priority: MessagePriority;

  /**
   * Retry count for failed processing
   */
  retryCount: number;

  /**
   * Recipient user IDs for fanout
   * Used by consumer to determine delivery targets
   */
  recipientIds: string[];

  /**
   * Client metadata (device, platform, version)
   */
  client?: {
    deviceId?: string;
    platform?: string;
    version?: string;
  };

  /**
   * Processing flags
   */
  flags?: {
    isEdited?: boolean;
    isDeleted?: boolean;
    requiresReceipt?: boolean;
    replyToId?: string;
    threadId?: string;
  };
}

export enum MessagePriority {
  NORMAL = 0,
  HIGH = 1,
  URGENT = 2,
}

/**
 * Ingress acknowledgment returned to client
 * Fast ACK with pending state before persistence
 */
export interface IngressAck {
  /**
   * Assigned message ID
   */
  messageId: string;

  /**
   * Correlation ID for tracing
   */
  correlationId: string;

  /**
   * Initial state (always "pending" at ingress)
   */
  state: "pending";

  /**
   * Timestamp when accepted
   */
  acceptedAt: string;

  /**
   * Idempotency key used
   */
  idempotencyKey: string;

  /**
   * Whether this was an idempotent hit (duplicate)
   */
  idempotentHit: boolean;
}

/**
 * Stream partition key generation
 */
export interface PartitionKey {
  /**
   * Stream key in Redis
   * Format: "msg:stream:{partition}"
   */
  streamKey: string;

  /**
   * Partition number (0-based)
   */
  partitionNumber: number;

  /**
   * Total partitions in cluster
   */
  totalPartitions: number;
}

/**
 * Consumer offset tracking
 */
export interface ConsumerOffset {
  /**
   * Consumer group name
   */
  consumerGroup: string;

  /**
   * Consumer name within group
   */
  consumerName: string;

  /**
   * Partition being consumed
   */
  partition: number;

  /**
   * Last processed stream ID
   */
  lastId: string;

  /**
   * Timestamp of last processed message
   */
  lastProcessedAt: string;

  /**
   * Number of messages processed
   */
  processedCount: number;

  /**
   * Current lag (messages pending)
   */
  lag: number;
}

/**
 * Dead letter queue entry
 */
export interface DeadLetterEntry {
  /**
   * Original envelope
   */
  envelope: MessageEnvelope;

  /**
   * Failure reason
   */
  reason: string;

  /**
   * Error details
   */
  error: {
    message: string;
    stack?: string;
    code?: string;
  };

  /**
   * Number of retry attempts
   */
  retryCount: number;

  /**
   * When message was dead-lettered
   */
  deadLetteredAt: string;

  /**
   * Original stream and ID
   */
  source: {
    streamKey: string;
    streamId: string;
  };
}
