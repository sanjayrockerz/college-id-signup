import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../src/infra/prisma/prisma.service";
import { DatabaseAccessLayer } from "../../src/common/services/database-access-layer.service";
import { CacheService } from "../../src/common/services/cache.service";
import { ReadReplicaCircuitBreaker } from "../../src/common/services/read-replica-circuit-breaker.service";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * Chaos Engineering Tests for Data Layer
 *
 * SCENARIOS:
 * 1. Replica Lag Induction - Pause replication, verify primary fallback
 * 2. Cache Failure - Disable Redis, verify DB meets SLOs with headroom
 * 3. Pool Exhaustion - Max out connections, verify queue behavior
 * 4. Network Partition - Simulate replica unreachable
 * 5. Slow Query Storm - Run expensive queries, verify isolation
 *
 * VALIDATION:
 * - All scenarios complete without user-visible errors
 * - Circuit breaker transitions correctly
 * - Metrics reflect degraded state
 * - Recovery happens automatically
 * - Performance degrades gracefully (no cliff)
 */

describe("Chaos Engineering - Data Layer Resilience", () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let dal: DatabaseAccessLayer;
  let cache: CacheService;
  let circuitBreaker: ReadReplicaCircuitBreaker;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [
        PrismaService,
        DatabaseAccessLayer,
        CacheService,
        ReadReplicaCircuitBreaker,
      ],
    }).compile();

    prisma = module.get<PrismaService>(PrismaService);
    dal = module.get<DatabaseAccessLayer>(DatabaseAccessLayer);
    cache = module.get<CacheService>(CacheService);
    circuitBreaker = module.get<ReadReplicaCircuitBreaker>(
      ReadReplicaCircuitBreaker,
    );

    // Ensure clean state
    await circuitBreaker.reset();
  });

  afterAll(async () => {
    await module.close();
  });

  describe("Scenario 1: Replica Lag Induction", () => {
    /**
     * Test: Induce replica lag by pausing replication
     * Expectation: Circuit breaker opens, requests route to primary
     * Recovery: Resume replication, circuit closes after cooldown
     */
    it("should fallback to primary when replica lag exceeds threshold", async () => {
      // Record baseline lag
      const baselineLag = await getReplicaLag();
      expect(baselineLag).toBeLessThan(5); // Healthy lag < 5s

      // Induce lag by pausing replication
      console.log("🔥 Inducing replica lag by pausing replication...");
      await pauseReplication();

      // Wait for lag to exceed threshold
      await new Promise((resolve) => setTimeout(resolve, 10000)); // 10s

      // Verify lag increased
      const laggedValue = await getReplicaLag();
      console.log(
        `   Replica lag: ${laggedValue}s (baseline: ${baselineLag}s)`,
      );
      expect(laggedValue).toBeGreaterThan(baselineLag);

      // Make read request
      const startTime = Date.now();
      const messages = await dal.findMany(
        "message.history",
        (prisma) =>
          prisma.message.findMany({
            where: { conversationId: "test-conv" },
            take: 50,
          }),
        { useReplica: true }, // Request replica, should fallback to primary
      );
      const responseTime = Date.now() - startTime;

      // Verify request succeeded
      expect(messages).toBeDefined();
      expect(Array.isArray(messages)).toBe(true);

      // Verify circuit breaker opened
      const state = await circuitBreaker.getState();
      expect(state).toBe("OPEN");

      // Verify response time still acceptable (primary handled it)
      expect(responseTime).toBeLessThan(500); // Should be fast on primary

      // Resume replication
      console.log("🔧 Resuming replication...");
      await resumeReplication();

      // Wait for recovery
      await new Promise((resolve) => setTimeout(resolve, 30000)); // 30s

      // Verify lag returned to normal
      const recoveredLag = await getReplicaLag();
      console.log(`   Recovered lag: ${recoveredLag}s`);
      expect(recoveredLag).toBeLessThan(5);

      // Verify circuit breaker closed
      await circuitBreaker.attemptReset();
      const finalState = await circuitBreaker.getState();
      expect(finalState).toBe("CLOSED");
    }, 120000); // 2 minute timeout

    /**
     * Test: Verify primary fallback happens quickly
     * Expectation: Fallback within 30 seconds of lag detection
     */
    it("should fallback within 30s of lag exceeding threshold", async () => {
      // Pause replication
      await pauseReplication();

      const startTime = Date.now();
      let fallbackOccurred = false;

      // Poll circuit breaker state
      while (Date.now() - startTime < 30000) {
        // 30s timeout
        const state = await circuitBreaker.getState();
        if (state === "OPEN") {
          fallbackOccurred = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Check every 1s
      }

      const fallbackTime = Date.now() - startTime;

      // Resume replication
      await resumeReplication();

      // Verify fallback occurred quickly
      expect(fallbackOccurred).toBe(true);
      expect(fallbackTime).toBeLessThan(30000);

      console.log(
        `   ✅ Fallback occurred in ${(fallbackTime / 1000).toFixed(1)}s`,
      );
    }, 60000);
  });

  describe("Scenario 2: Cache Failure", () => {
    /**
     * Test: Disable Redis, verify DB meets SLOs directly
     * Expectation: Queries succeed with acceptable latency
     * Recovery: Re-enable Redis, verify cache usage resumes
     */
    it("should meet SLOs when cache is unavailable", async () => {
      // Stop Redis
      console.log("🔥 Stopping Redis...");
      await stopRedis();

      // Wait for cache to detect failure
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Run queries without cache
      const queries = Array(100)
        .fill(null)
        .map(async (_, i) => {
          const startTime = Date.now();

          try {
            const messages = await dal.findMany(
              "message.history",
              (prisma) =>
                prisma.message.findMany({
                  where: { conversationId: `conv-${i % 10}` },
                  take: 50,
                }),
              { useCache: true }, // Request cache, should fallback to DB
            );

            const responseTime = Date.now() - startTime;
            return { success: true, responseTime, error: null };
          } catch (error) {
            return { success: false, responseTime: 0, error };
          }
        });

      const results = await Promise.all(queries);

      // Verify all queries succeeded
      const successRate =
        results.filter((r) => r.success).length / results.length;
      expect(successRate).toBeGreaterThanOrEqual(0.99); // 99% success rate

      // Verify acceptable latency (no cache = higher latency, but still < SLO)
      const responseTimes = results
        .filter((r) => r.success)
        .map((r) => r.responseTime);
      const p95 = percentile(responseTimes, 0.95);

      console.log(`   DB-only P95: ${p95.toFixed(2)}ms`);
      expect(p95).toBeLessThan(500); // Higher than with cache, but acceptable

      // Start Redis
      console.log("🔧 Starting Redis...");
      await startRedis();

      // Wait for cache to reconnect
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Verify cache usage resumes
      const cacheTestKey = "chaos-test-key";
      await cache.set(cacheTestKey, "test-value", 60);
      const cachedValue = await cache.get(cacheTestKey);

      expect(cachedValue).toBe("test-value");
      console.log("   ✅ Cache recovered and operational");
    }, 120000);
  });

  describe("Scenario 3: Pool Exhaustion", () => {
    /**
     * Test: Saturate connection pool, verify queue behavior
     * Expectation: Requests queue gracefully, no errors
     * Metrics: db_tx_queue_wait_ms increases but bounded
     */
    it("should queue requests gracefully when pool saturated", async () => {
      // Get pool size
      const poolSize = parseInt(process.env.DATABASE_POOL_SIZE || "20", 10);

      console.log(`🔥 Saturating connection pool (size: ${poolSize})...`);

      // Create more connections than pool size
      const concurrency = poolSize * 2;

      // Long-running queries to hold connections
      const longQueries = Array(concurrency)
        .fill(null)
        .map(async () => {
          const startTime = Date.now();

          try {
            await prisma.$queryRaw`SELECT pg_sleep(5)`; // 5s sleep

            const responseTime = Date.now() - startTime;
            return { success: true, responseTime, error: null };
          } catch (error) {
            return { success: false, responseTime: 0, error };
          }
        });

      const results = await Promise.all(longQueries);

      // Verify all queries succeeded (even if queued)
      const successRate =
        results.filter((r) => r.success).length / results.length;
      expect(successRate).toBeGreaterThanOrEqual(0.95); // 95% success rate

      // Verify some queries were queued
      const responseTimes = results
        .filter((r) => r.success)
        .map((r) => r.responseTime);
      const maxResponseTime = Math.max(...responseTimes);

      console.log(`   Max queue wait: ${maxResponseTime.toFixed(0)}ms`);
      expect(maxResponseTime).toBeGreaterThan(5000); // Some waited in queue
      expect(maxResponseTime).toBeLessThan(30000); // But not forever (timeout)

      // Verify queue wait metric increased
      const queueWait = await getMetric("db_tx_queue_wait_ms");
      console.log(`   Queue wait metric: ${queueWait.toFixed(2)}ms`);
      expect(queueWait).toBeGreaterThan(0);
    }, 120000);
  });

  describe("Scenario 4: Network Partition", () => {
    /**
     * Test: Simulate replica unreachable via firewall
     * Expectation: Circuit breaker opens, no user errors
     */
    it("should handle replica network partition gracefully", async () => {
      // Block replica traffic
      console.log("🔥 Simulating network partition to replica...");
      await blockReplicaTraffic();

      // Make read requests
      const queries = Array(50)
        .fill(null)
        .map(async () => {
          const startTime = Date.now();

          try {
            const messages = await dal.findMany(
              "message.history",
              (prisma) =>
                prisma.message.findMany({
                  where: { conversationId: "test-conv" },
                  take: 50,
                }),
              { useReplica: true },
            );

            const responseTime = Date.now() - startTime;
            return { success: true, responseTime, error: null };
          } catch (error) {
            return { success: false, responseTime: 0, error };
          }
        });

      const results = await Promise.all(queries);

      // Verify all succeeded (via primary fallback)
      const successRate =
        results.filter((r) => r.success).length / results.length;
      expect(successRate).toBe(1.0); // 100% success rate

      // Verify circuit breaker opened
      const state = await circuitBreaker.getState();
      expect(state).toBe("OPEN");

      // Unblock replica traffic
      console.log("🔧 Restoring network to replica...");
      await unblockReplicaTraffic();

      // Wait for circuit to half-open and test
      await new Promise((resolve) => setTimeout(resolve, 30000));
      await circuitBreaker.attemptReset();

      // Verify circuit closed
      const finalState = await circuitBreaker.getState();
      expect(finalState).toBe("CLOSED");

      console.log("   ✅ Network partition handled gracefully");
    }, 120000);
  });

  describe("Scenario 5: Slow Query Storm", () => {
    /**
     * Test: Run expensive queries, verify isolation
     * Expectation: Slow queries don't block fast queries
     * Validation: Fast query pool remains responsive
     */
    it("should isolate slow queries from fast queries", async () => {
      console.log("🔥 Generating slow query storm...");

      // Start slow queries (10 concurrent)
      const slowQueries = Array(10)
        .fill(null)
        .map(
          () =>
            prisma.$queryRaw`
          SELECT pg_sleep(10)
        `,
        );

      // Wait a bit for slow queries to start
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Run fast queries concurrently
      const fastQueries = Array(50)
        .fill(null)
        .map(async () => {
          const startTime = Date.now();

          const messages = await prisma.message.findMany({
            where: { conversationId: "test-conv" },
            take: 10,
          });

          const responseTime = Date.now() - startTime;
          return responseTime;
        });

      const fastResponseTimes = await Promise.all(fastQueries);

      // Verify fast queries remained fast
      const p95Fast = percentile(fastResponseTimes, 0.95);

      console.log(`   Fast query P95: ${p95Fast.toFixed(2)}ms`);
      expect(p95Fast).toBeLessThan(200); // Fast queries unaffected

      // Clean up slow queries
      await Promise.all(slowQueries);

      console.log("   ✅ Slow queries isolated successfully");
    }, 60000);
  });
});

/**
 * Helper: Get replica lag in seconds
 */
async function getReplicaLag(): Promise<number> {
  try {
    const result = await execAsync(
      `psql ${process.env.REPLICA_DATABASE_URL} -t -c "SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))"`,
    );
    return parseFloat(result.stdout.trim());
  } catch (error) {
    console.warn("Failed to get replica lag:", error);
    return 0;
  }
}

/**
 * Helper: Pause replication
 */
async function pauseReplication(): Promise<void> {
  try {
    await execAsync(
      `psql ${process.env.REPLICA_DATABASE_URL} -c "SELECT pg_wal_replay_pause()"`,
    );
    console.log("   ✅ Replication paused");
  } catch (error) {
    console.error("Failed to pause replication:", error);
  }
}

/**
 * Helper: Resume replication
 */
async function resumeReplication(): Promise<void> {
  try {
    await execAsync(
      `psql ${process.env.REPLICA_DATABASE_URL} -c "SELECT pg_wal_replay_resume()"`,
    );
    console.log("   ✅ Replication resumed");
  } catch (error) {
    console.error("Failed to resume replication:", error);
  }
}

/**
 * Helper: Stop Redis
 */
async function stopRedis(): Promise<void> {
  try {
    await execAsync("docker-compose stop redis");
    console.log("   ✅ Redis stopped");
  } catch (error) {
    console.error("Failed to stop Redis:", error);
  }
}

/**
 * Helper: Start Redis
 */
async function startRedis(): Promise<void> {
  try {
    await execAsync("docker-compose start redis");
    console.log("   ✅ Redis started");
  } catch (error) {
    console.error("Failed to start Redis:", error);
  }
}

/**
 * Helper: Block replica traffic
 */
async function blockReplicaTraffic(): Promise<void> {
  try {
    const replicaHost = new URL(process.env.REPLICA_DATABASE_URL || "")
      .hostname;
    await execAsync(`sudo iptables -A OUTPUT -d ${replicaHost} -j DROP`);
    console.log("   ✅ Replica traffic blocked");
  } catch (error) {
    console.error("Failed to block replica traffic:", error);
  }
}

/**
 * Helper: Unblock replica traffic
 */
async function unblockReplicaTraffic(): Promise<void> {
  try {
    const replicaHost = new URL(process.env.REPLICA_DATABASE_URL || "")
      .hostname;
    await execAsync(`sudo iptables -D OUTPUT -d ${replicaHost} -j DROP`);
    console.log("   ✅ Replica traffic unblocked");
  } catch (error) {
    console.error("Failed to unblock replica traffic:", error);
  }
}

/**
 * Helper: Get metric from Prometheus
 */
async function getMetric(metricName: string): Promise<number> {
  try {
    const prometheusUrl = process.env.PROMETHEUS_URL || "http://localhost:9090";
    const response = await fetch(
      `${prometheusUrl}/api/v1/query?query=${metricName}`,
    );
    const data = await response.json();
    return parseFloat(data.data?.result?.[0]?.value?.[1] || "0");
  } catch (error) {
    console.warn(`Failed to get metric ${metricName}:`, error);
    return 0;
  }
}

/**
 * Helper: Calculate percentile
 */
function percentile(values: number[], p: number): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * p) - 1;
  return sorted[index];
}
