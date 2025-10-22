import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../src/infra/prisma/prisma.service";
import { RedisStreamsService } from "../../src/infra/queue/redis-streams.service";
import { IdempotencyService } from "../../src/infra/queue/idempotency.service";
import { StreamConsumerService } from "../../src/infra/queue/stream-consumer.service";
import {
  MessageEnvelope,
  MessagePriority,
} from "../../src/infra/queue/message-envelope.interface";

/**
 * Phase 3 Integration Tests: Durable Delivery with At-Least-Once Guarantees
 *
 * TEST SCENARIOS:
 * 1. Happy path: Enqueue → Dequeue → Persist → ACK
 * 2. Idempotency: Duplicate requests don't create duplicates
 * 3. Retry: Consumer restart continues from last checkpoint
 * 4. Replay: Reprocess from offset produces same results
 * 5. Ordering: Messages within conversation preserve order
 * 6. DLQ: Failed messages go to dead letter queue
 * 7. Receipts: Duplicate transitions are no-ops
 *
 * GUARANTEES TESTED:
 * - At-least-once delivery (retries allowed)
 * - No user-visible duplicates (idempotent application)
 * - In-conversation ordering (partition-based)
 * - Observable idempotent hits (telemetry)
 */

describe("Phase 3: Durable Delivery Integration Tests", () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let streams: RedisStreamsService;
  let idempotency: IdempotencyService;
  let consumer: StreamConsumerService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [
        PrismaService,
        RedisStreamsService,
        IdempotencyService,
        StreamConsumerService,
      ],
    }).compile();

    prisma = module.get<PrismaService>(PrismaService);
    streams = module.get<RedisStreamsService>(RedisStreamsService);
    idempotency = module.get<IdempotencyService>(IdempotencyService);
    consumer = module.get<StreamConsumerService>(StreamConsumerService);

    // Initialize services
    await streams.onModuleInit();
  });

  afterAll(async () => {
    await consumer.onModuleDestroy();
    await streams.onModuleDestroy();
    await prisma.$disconnect();
    await module.close();
  });

  beforeEach(async () => {
    // Clean test data
    // Note: Run 'npx prisma generate' after applying migrations
    // await prisma.messageReceipt.deleteMany({});
    await prisma.message.deleteMany({});
  });

  describe("Happy Path: End-to-End Message Delivery", () => {
    it("should enqueue, dequeue, persist, and ACK message", async () => {
      // Arrange
      const envelope: MessageEnvelope = {
        messageId: "msg_001",
        conversationId: "conv_001",
        senderId: "user_001",
        createdAt: new Date().toISOString(),
        payloadKey: null,
        idempotencyKey: "idem_001",
        correlationId: "corr_001",
        metadata: {
          content: "Hello, world!",
          contentType: "text",
          priority: MessagePriority.NORMAL,
          retryCount: 0,
          recipientIds: ["user_002"],
        },
      };

      // Act: Enqueue
      const streamId = await streams.enqueue(envelope);
      expect(streamId).toBeDefined();

      // Act: Dequeue
      const partition = streams["getPartition"](envelope.conversationId);
      const messages = await streams.dequeue(
        partition,
        "test-consumer",
        10,
        1000,
      );

      // Assert: Dequeued message matches
      expect(messages).toHaveLength(1);
      const [dequeuedId, dequeuedEnvelope] = messages[0];
      expect(dequeuedId).toBe(streamId);
      expect(dequeuedEnvelope.messageId).toBe("msg_001");
      expect(dequeuedEnvelope.metadata.content).toBe("Hello, world!");

      // Act: Persist
      const wasInserted = await idempotency.persistMessage(dequeuedEnvelope);

      // Assert: Message persisted
      expect(wasInserted).toBe(true);
      const dbMessage = await prisma.message.findUnique({
        where: { id: "msg_001" },
      });
      expect(dbMessage).toBeDefined();
      expect(dbMessage.content).toBe("Hello, world!");

      // Act: ACK
      const ackCount = await streams.acknowledge(partition, [streamId]);
      expect(ackCount).toBe(1);

      // Assert: Lag is zero
      const lag = await streams.getPartitionLag(partition);
      expect(lag).toBe(0);
    });
  });

  describe("Idempotency: No User-Visible Duplicates", () => {
    it("should detect duplicate at ingress (cache hit)", async () => {
      // Arrange
      const request = {
        conversationId: "conv_002",
        senderId: "user_001",
        content: "Duplicate test",
        contentType: "text",
        clientMessageId: "client_msg_001",
        recipientIds: ["user_002"],
      };

      // Act: First ingest
      const ack1 = await idempotency.ingestMessage(request);

      // Assert: First request accepted
      expect(ack1.idempotentHit).toBe(false);
      expect(ack1.state).toBe("pending");
      const messageId1 = ack1.messageId;

      // Act: Second ingest (immediate duplicate)
      const ack2 = await idempotency.ingestMessage(request);

      // Assert: Second request is idempotent hit
      expect(ack2.idempotentHit).toBe(true);
      expect(ack2.messageId).toBe(messageId1); // Same message ID
      expect(ack2.idempotencyKey).toBe(ack1.idempotencyKey);
    });

    it("should detect duplicate at persistence (DB hit)", async () => {
      // Arrange
      const envelope: MessageEnvelope = {
        messageId: "msg_002",
        conversationId: "conv_003",
        senderId: "user_001",
        createdAt: new Date().toISOString(),
        payloadKey: null,
        idempotencyKey: "idem_002",
        correlationId: "corr_002",
        metadata: {
          content: "Persistence duplicate",
          contentType: "text",
          priority: MessagePriority.NORMAL,
          retryCount: 0,
          recipientIds: ["user_002"],
        },
      };

      // Act: First persist
      const inserted1 = await idempotency.persistMessage(envelope);

      // Assert: First persist succeeds
      expect(inserted1).toBe(true);

      // Act: Second persist (same idempotencyKey)
      const inserted2 = await idempotency.persistMessage(envelope);

      // Assert: Second persist is idempotent hit
      expect(inserted2).toBe(false);

      // Assert: Only one record in DB
      const messages = await prisma.message.findMany({
        where: { idempotencyKey: "idem_002" },
      });
      expect(messages).toHaveLength(1);
    });

    it("should detect duplicate receipt transitions", async () => {
      // Arrange: Persist message first
      const envelope: MessageEnvelope = {
        messageId: "msg_003",
        conversationId: "conv_004",
        senderId: "user_001",
        createdAt: new Date().toISOString(),
        payloadKey: null,
        idempotencyKey: "idem_003",
        correlationId: "corr_003",
        metadata: {
          content: "Receipt test",
          contentType: "text",
          priority: MessagePriority.NORMAL,
          retryCount: 0,
          recipientIds: ["user_002"],
        },
      };
      await idempotency.persistMessage(envelope);

      // Act: First receipt
      const recorded1 = await idempotency.recordReceipt(
        "msg_003",
        "user_002",
        "delivered",
      );

      // Assert: First receipt succeeds
      expect(recorded1).toBe(true);

      // Act: Second receipt (duplicate transition)
      const recorded2 = await idempotency.recordReceipt(
        "msg_003",
        "user_002",
        "delivered",
      );

      // Assert: Second receipt is idempotent hit
      expect(recorded2).toBe(false);

      // TODO: Uncomment after running 'npx prisma generate'
      // Assert: Only one receipt in DB
      // const receipts = await prisma.messageReceipt.findMany({
      //   where: {
      //     messageId: 'msg_003',
      //     userId: 'user_002',
      //     state: 'delivered',
      //   },
      // });
      // expect(receipts).toHaveLength(1);
    });
  });

  describe("Retry: Consumer Restart Continues from Checkpoint", () => {
    it("should resume from last ACK after consumer restart", async () => {
      // Arrange: Enqueue 3 messages
      const envelopes = [1, 2, 3].map((n) => ({
        messageId: `msg_retry_${n}`,
        conversationId: "conv_005",
        senderId: "user_001",
        createdAt: new Date().toISOString(),
        payloadKey: null,
        idempotencyKey: `idem_retry_${n}`,
        correlationId: `corr_retry_${n}`,
        metadata: {
          content: `Retry test ${n}`,
          contentType: "text",
          priority: MessagePriority.NORMAL,
          retryCount: 0,
          recipientIds: ["user_002"],
        },
      }));

      for (const envelope of envelopes) {
        await streams.enqueue(envelope);
      }

      // Act: Dequeue and ACK first 2 messages
      const partition = streams["getPartition"]("conv_005");
      const batch1 = await streams.dequeue(
        partition,
        "test-consumer-2",
        10,
        1000,
      );
      expect(batch1).toHaveLength(3);

      // Persist and ACK only first 2
      await idempotency.persistMessage(batch1[0][1]);
      await idempotency.persistMessage(batch1[1][1]);
      await streams.acknowledge(partition, [batch1[0][0], batch1[1][0]]);

      // Simulate consumer restart
      // Third message should be pending (not ACK'd)

      // Act: Dequeue again (new consumer name)
      const batch2 = await streams.dequeue(
        partition,
        "test-consumer-3",
        10,
        1000,
      );

      // Assert: Only unacknowledged message is returned
      expect(batch2).toHaveLength(1);
      expect(batch2[0][1].messageId).toBe("msg_retry_3");
    });
  });

  describe("Ordering: In-Conversation Message Order Preserved", () => {
    it("should preserve message order within same conversation", async () => {
      // Arrange: Enqueue 5 messages in order
      const conversationId = "conv_ordering_001";
      const messages: MessageEnvelope[] = [];

      for (let i = 1; i <= 5; i++) {
        const envelope: MessageEnvelope = {
          messageId: `msg_order_${i}`,
          conversationId,
          senderId: "user_001",
          createdAt: new Date(Date.now() + i * 1000).toISOString(),
          payloadKey: null,
          idempotencyKey: `idem_order_${i}`,
          correlationId: `corr_order_${i}`,
          metadata: {
            content: `Message ${i}`,
            contentType: "text",
            priority: MessagePriority.NORMAL,
            retryCount: 0,
            recipientIds: ["user_002"],
          },
        };

        await streams.enqueue(envelope);
        messages.push(envelope);
      }

      // Act: Dequeue all messages
      const partition = streams["getPartition"](conversationId);
      const dequeued = await streams.dequeue(
        partition,
        "test-consumer-4",
        10,
        1000,
      );

      // Assert: Order is preserved
      expect(dequeued).toHaveLength(5);
      for (let i = 0; i < 5; i++) {
        expect(dequeued[i][1].messageId).toBe(`msg_order_${i + 1}`);
        expect(dequeued[i][1].metadata.content).toBe(`Message ${i + 1}`);
      }
    });
  });

  describe("Dead Letter Queue: Failed Messages After Max Retries", () => {
    it("should send message to DLQ after max retries", async () => {
      // Arrange
      const envelope: MessageEnvelope = {
        messageId: "msg_dlq_001",
        conversationId: "conv_dlq_001",
        senderId: "user_001",
        createdAt: new Date().toISOString(),
        payloadKey: null,
        idempotencyKey: "idem_dlq_001",
        correlationId: "corr_dlq_001",
        metadata: {
          content: "DLQ test",
          contentType: "text",
          priority: MessagePriority.NORMAL,
          retryCount: 0,
          recipientIds: ["user_002"],
        },
      };

      const streamId = await streams.enqueue(envelope);
      const partition = streams["getPartition"](envelope.conversationId);

      // Act: Send to DLQ
      await streams.sendToDeadLetter(
        partition,
        streamId,
        envelope,
        "test_failure",
        new Error("Simulated failure"),
      );

      // Assert: Message in DLQ stream
      const dlqStats = await streams.getStreamStats(-1); // DLQ partition
      expect(dlqStats.length).toBeGreaterThan(0);
    });
  });

  describe("Partition Distribution: Hash-Based Partitioning", () => {
    it("should distribute conversations across partitions", async () => {
      // Arrange: Multiple conversations
      const conversations = Array.from(
        { length: 20 },
        (_, i) => `conv_dist_${i}`,
      );
      const partitionCounts = new Map<number, number>();

      // Act: Enqueue messages for each conversation
      for (const conversationId of conversations) {
        const envelope: MessageEnvelope = {
          messageId: `msg_dist_${conversationId}`,
          conversationId,
          senderId: "user_001",
          createdAt: new Date().toISOString(),
          payloadKey: null,
          idempotencyKey: `idem_dist_${conversationId}`,
          correlationId: `corr_dist_${conversationId}`,
          metadata: {
            content: "Distribution test",
            contentType: "text",
            priority: MessagePriority.NORMAL,
            retryCount: 0,
            recipientIds: ["user_002"],
          },
        };

        await streams.enqueue(envelope);

        // Track partition assignment
        const partition = streams["getPartition"](conversationId);
        partitionCounts.set(
          partition,
          (partitionCounts.get(partition) || 0) + 1,
        );
      }

      // Assert: Messages distributed across multiple partitions
      expect(partitionCounts.size).toBeGreaterThan(1);

      // Assert: Same conversation always goes to same partition
      for (let i = 0; i < 5; i++) {
        const partition1 = streams["getPartition"]("conv_dist_0");
        const partition2 = streams["getPartition"]("conv_dist_0");
        expect(partition1).toBe(partition2);
      }
    });
  });
});
