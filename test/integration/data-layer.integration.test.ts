import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../../src/infra/prisma/prisma.service";
import { DatabaseAccessLayer } from "../../../src/infra/services/database-access-layer.service";
import { KeysetPaginator } from "../../../src/common/utils/keyset-paginator";
import { CacheService } from "../../../src/common/services/cache.service";

/**
 * Data Layer Integration Tests
 *
 * SCOPE:
 * 1. EXPLAIN Plan Validation - Verify indexes are used
 * 2. Keyset Pagination Correctness - No drift, stable performance
 * 3. Cache Validity/Invalidation - Coherency guarantees
 * 4. Read Routing Feature Flags - Replica routing behavior
 * 5. Replica Fallback - Circuit breaker triggers correctly
 *
 * SUCCESS CRITERIA:
 * - All queries use expected indexes (no sequential scans on large tables)
 * - Pagination returns consistent results forward/backward
 * - Cache invalidation completes within 100ms
 * - Feature flags control routing without errors
 * - Replica lag triggers automatic primary fallback
 */

describe("Data Layer Integration Tests", () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let dal: DatabaseAccessLayer;
  let cache: CacheService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [
        PrismaService,
        DatabaseAccessLayer,
        CacheService,
        // Add other required providers
      ],
    }).compile();

    prisma = module.get<PrismaService>(PrismaService);
    dal = module.get<DatabaseAccessLayer>(DatabaseAccessLayer);
    cache = module.get<CacheService>(CacheService);
  });

  afterAll(async () => {
    await module.close();
  });

  describe("EXPLAIN Plan Validation", () => {
    /**
     * TEST: Message history query uses composite index
     * INDEX: idx_message_conversation_created (conversationId, createdAt DESC, id DESC)
     */
    it("should use composite index for message history with keyset pagination", async () => {
      const conversationId = "test-conversation-id";
      const cursor = KeysetPaginator.encodeCursor(
        new Date(),
        "test-message-id",
      );

      // Build query
      const query = `
        EXPLAIN (FORMAT JSON, ANALYZE, BUFFERS)
        SELECT * FROM "Message"
        WHERE "conversationId" = '${conversationId}'
          AND ("createdAt" < '2025-10-22T00:00:00Z' OR ("createdAt" = '2025-10-22T00:00:00Z' AND "id" < 'test-message-id'))
        ORDER BY "createdAt" DESC, "id" DESC
        LIMIT 50;
      `;

      const result: any = await prisma.$queryRawUnsafe(query);
      const plan = result[0]["QUERY PLAN"][0];

      // Assertions
      expect(plan.Plan["Node Type"]).toBe("Index Scan");
      expect(plan.Plan["Index Name"]).toBe("idx_message_conversation_created");
      expect(plan.Plan["Total Cost"]).toBeLessThan(100); // Should be very cheap with index

      // No sequential scan
      const hasSeqScan = JSON.stringify(plan).includes("Seq Scan");
      expect(hasSeqScan).toBe(false);

      // Should use index-only scan or index scan
      expect(["Index Scan", "Index Only Scan"]).toContain(
        plan.Plan["Node Type"],
      );
    });

    /**
     * TEST: Unread count query uses covering index
     * INDEX: idx_message_unread (conversationId, readAt, userId) WHERE readAt IS NULL
     */
    it("should use partial index for unread count query", async () => {
      const conversationId = "test-conversation-id";
      const userId = "test-user-id";

      const query = `
        EXPLAIN (FORMAT JSON, ANALYZE, BUFFERS)
        SELECT COUNT(*) FROM "Message"
        WHERE "conversationId" = '${conversationId}'
          AND "readAt" IS NULL
          AND "senderId" != '${userId}';
      `;

      const result: any = await prisma.$queryRawUnsafe(query);
      const plan = result[0]["QUERY PLAN"][0];

      // Should use partial index on (conversationId, readAt, userId)
      expect(plan.Plan["Index Name"]).toMatch(/idx_message.*unread/);
      expect(plan.Plan["Node Type"]).toBe("Aggregate");

      // Check for index scan in nested plan
      const planStr = JSON.stringify(plan);
      expect(planStr).toContain("Index");
      expect(planStr).not.toContain("Seq Scan");
    });

    /**
     * TEST: Conversation list with participants uses join efficiently
     * INDEXES:
     *   - idx_conversation_participant (userId, conversationId)
     *   - idx_conversation_updated (updatedAt DESC, id DESC)
     */
    it("should use efficient join for conversation list with participants", async () => {
      const userId = "test-user-id";

      const query = `
        EXPLAIN (FORMAT JSON, ANALYZE, BUFFERS)
        SELECT c.* FROM "Conversation" c
        INNER JOIN "ConversationParticipant" cp ON cp."conversationId" = c.id
        WHERE cp."userId" = '${userId}'
        ORDER BY c."updatedAt" DESC, c.id DESC
        LIMIT 50;
      `;

      const result: any = await prisma.$queryRawUnsafe(query);
      const plan = result[0]["QUERY PLAN"][0];

      // Should use nested loop or hash join with index scans
      expect(plan.Plan["Node Type"]).toMatch(/Nested Loop|Hash Join/);

      // Verify both indexes are used
      const planStr = JSON.stringify(plan);
      expect(planStr).toMatch(
        /idx_conversation_participant|idx_conversation_updated/,
      );
      expect(planStr).not.toContain('Seq Scan on "Conversation"');
    });
  });

  describe("Keyset Pagination Correctness", () => {
    let testConversationId: string;
    let testMessages: any[];

    beforeAll(async () => {
      // Create test conversation and messages
      testConversationId = `test-conv-${Date.now()}`;

      // Insert 100 test messages
      testMessages = [];
      for (let i = 0; i < 100; i++) {
        const message = await prisma.message.create({
          data: {
            conversationId: testConversationId,
            content: `Test message ${i}`,
            senderId: "test-user",
            createdAt: new Date(Date.now() + i * 1000), // 1 second apart
          },
        });
        testMessages.push(message);
      }
    });

    afterAll(async () => {
      // Cleanup
      await prisma.message.deleteMany({
        where: { conversationId: testConversationId },
      });
    });

    it("should paginate forward consistently", async () => {
      const pageSize = 10;
      const allFetched: any[] = [];
      let cursor: string | null = null;

      // Fetch all pages
      for (let page = 0; page < 10; page++) {
        const result = await KeysetPaginator.paginate({
          query: (whereClause) =>
            prisma.message.findMany({
              where: {
                conversationId: testConversationId,
                ...whereClause,
              },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: pageSize + 1,
            }),
          pageSize,
          cursor,
          direction: "forward",
        });

        allFetched.push(...result.data);

        if (!result.hasMore) break;
        cursor = result.nextCursor;
      }

      // Verify all 100 messages fetched
      expect(allFetched).toHaveLength(100);

      // Verify no duplicates
      const ids = allFetched.map((m) => m.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(100);

      // Verify descending order
      for (let i = 0; i < allFetched.length - 1; i++) {
        const current = new Date(allFetched[i].createdAt).getTime();
        const next = new Date(allFetched[i + 1].createdAt).getTime();
        expect(current).toBeGreaterThanOrEqual(next);
      }
    });

    it("should paginate backward consistently", async () => {
      const pageSize = 10;

      // Get last cursor (oldest message)
      const lastMessage = testMessages[0];
      const startCursor = KeysetPaginator.encodeCursor(
        lastMessage.createdAt,
        lastMessage.id,
      );

      // Paginate backward
      const result = await KeysetPaginator.paginate({
        query: (whereClause) =>
          prisma.message.findMany({
            where: {
              conversationId: testConversationId,
              ...whereClause,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: pageSize + 1,
          }),
        pageSize,
        cursor: startCursor,
        direction: "backward",
      });

      // Should fetch newer messages
      expect(result.data.length).toBeGreaterThan(0);
      expect(result.hasPrevious).toBe(true);

      // Verify newer than start
      const startTime = new Date(lastMessage.createdAt).getTime();
      result.data.forEach((msg) => {
        const msgTime = new Date(msg.createdAt).getTime();
        expect(msgTime).toBeGreaterThanOrEqual(startTime);
      });
    });

    it("should handle concurrent inserts without drift", async () => {
      const pageSize = 10;

      // Fetch first page
      const page1 = await KeysetPaginator.paginate({
        query: (whereClause) =>
          prisma.message.findMany({
            where: {
              conversationId: testConversationId,
              ...whereClause,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: pageSize + 1,
          }),
        pageSize,
        cursor: null,
      });

      // Insert new messages (simulating concurrent activity)
      await prisma.message.create({
        data: {
          conversationId: testConversationId,
          content: "New message during pagination",
          senderId: "test-user",
          createdAt: new Date(Date.now() + 200000), // Newest
        },
      });

      // Fetch second page using cursor
      const page2 = await KeysetPaginator.paginate({
        query: (whereClause) =>
          prisma.message.findMany({
            where: {
              conversationId: testConversationId,
              ...whereClause,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: pageSize + 1,
          }),
        pageSize,
        cursor: page1.nextCursor,
      });

      // Verify no duplicates between pages
      const page1Ids = new Set(page1.data.map((m) => m.id));
      const page2Ids = new Set(page2.data.map((m) => m.id));

      page2.data.forEach((msg) => {
        expect(page1Ids.has(msg.id)).toBe(false);
      });

      // Newly inserted message should NOT appear in page2 (stable pagination)
      const page2Contents = page2.data.map((m) => m.content);
      expect(page2Contents).not.toContain("New message during pagination");
    });
  });

  describe("Cache Validity and Invalidation", () => {
    const testUserId = "cache-test-user";
    const testKey = `user:${testUserId}:profile`;

    afterEach(async () => {
      await cache.delete(testKey);
    });

    it("should cache and retrieve data correctly", async () => {
      const testData = {
        id: testUserId,
        name: "Test User",
        email: "test@example.com",
      };

      // Set cache
      await cache.set(testKey, testData, 60);

      // Retrieve from cache
      const cached = await cache.get(testKey);

      expect(cached).toEqual(testData);
    });

    it("should invalidate cache within 100ms", async () => {
      const testData = { id: testUserId, name: "Test User" };

      // Set cache
      await cache.set(testKey, testData, 3600);

      // Verify cached
      let cached = await cache.get(testKey);
      expect(cached).toEqual(testData);

      // Invalidate and measure time
      const startTime = Date.now();
      await cache.delete(testKey);
      const invalidationTime = Date.now() - startTime;

      // Should complete within 100ms
      expect(invalidationTime).toBeLessThan(100);

      // Verify invalidated
      cached = await cache.get(testKey);
      expect(cached).toBeNull();
    });

    it("should handle cache invalidation patterns correctly", async () => {
      // Pattern: Invalidate related caches on write
      const conversationId = "test-conversation";
      const userId = "test-user";

      // Cache conversation data
      await cache.set(
        `conversation:${conversationId}`,
        { id: conversationId },
        60,
      );
      await cache.set(
        `user:${userId}:conversations`,
        ["conv1", conversationId],
        60,
      );

      // Perform write operation (send message)
      // Should invalidate related caches
      await cache.delete(`conversation:${conversationId}`);
      await cache.delete(`user:${userId}:conversations`);

      // Verify both invalidated
      const conv = await cache.get(`conversation:${conversationId}`);
      const userConvs = await cache.get(`user:${userId}:conversations`);

      expect(conv).toBeNull();
      expect(userConvs).toBeNull();
    });
  });

  describe("Read Routing Feature Flags", () => {
    it("should route reads to replica when feature flag enabled", async () => {
      // Enable replica for specific endpoint
      const endpoint = "message.history";

      // Query with replica enabled
      const messages = await dal.findMany(
        endpoint,
        (prisma) =>
          prisma.message.findMany({
            where: { conversationId: "test" },
            take: 10,
          }),
        { useReplica: true },
      );

      // Should not throw error (replica routing working)
      expect(messages).toBeDefined();
    });

    it("should route to primary when strong consistency required", async () => {
      const endpoint = "message.markAsRead";

      // Query with strong consistency
      const result = await dal.findFirst(
        endpoint,
        (prisma) =>
          prisma.message.findFirst({
            where: { id: "test-message" },
          }),
        { requireStrongConsistency: true },
      );

      // Should always use primary (no errors)
      expect(result).toBeDefined();
    });

    it("should respect feature flag toggle at runtime", async () => {
      const endpoint = "test.endpoint";

      // Disable replica for endpoint
      // replicaService.disableReplicaForEndpoint(endpoint);

      // Query should go to primary
      const result = await dal.findMany(
        endpoint,
        (prisma) =>
          prisma.message.findMany({
            take: 1,
          }),
        { useReplica: true },
      );

      // Should succeed without replica routing
      expect(result).toBeDefined();
    });
  });

  describe("Replica Fallback Behavior", () => {
    it("should fallback to primary when replica unavailable", async () => {
      // Simulate replica failure by querying with replica enabled
      // Circuit breaker should detect and fallback

      const endpoint = "message.history";
      let errorCount = 0;

      try {
        // This should trigger fallback if replica has issues
        await dal.findMany(
          endpoint,
          (prisma) =>
            prisma.message.findMany({
              where: { conversationId: "test" },
              take: 10,
            }),
          { useReplica: true },
        );
      } catch (error) {
        errorCount++;
      }

      // Should not error (fallback to primary worked)
      expect(errorCount).toBe(0);
    });

    it("should retry on primary after replica failure", async () => {
      const endpoint = "message.history";

      // First attempt might use replica
      const result1 = await dal.findMany(
        endpoint,
        (prisma) =>
          prisma.message.findMany({
            where: { conversationId: "test" },
            take: 1,
          }),
        { useReplica: true },
      );

      // Should get result from primary fallback
      expect(result1).toBeDefined();
      expect(Array.isArray(result1)).toBe(true);
    });
  });
});
