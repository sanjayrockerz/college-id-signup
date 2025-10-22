import { randomUUID } from "crypto";
import type { Redis } from "ioredis";
import { PresenceRegistry } from "../../src/realtime/presence-registry";
import {
  clearRedisClientsForTests,
  getRedisClients,
} from "../../src/realtime/redis-manager";
import { TelemetryMetrics } from "../../src/observability/metrics-registry";

const TEST_REALTIME_CONFIG = {
  adapterEnabled: true,
  redisUrl: undefined,
  redisUsername: undefined,
  redisPassword: undefined,
  redisTls: false,
  redisKeyPrefix: `test-${randomUUID()}`,
  useMockRedis: true,
  instanceId: `test-instance-${randomUUID()}`,
  heartbeatIntervalMs: 5000,
  presenceTtlMs: 15000,
} as const;

async function getMetricValue(
  metricName: string,
  labels: Record<string, string>,
): Promise<number> {
  const metric = TelemetryMetrics.registry().getSingleMetric(metricName);
  if (!metric) {
    return 0;
  }
  const snapshot = await metric.get();
  // Prom-client returns label/value pairs using plain objects, so we scan for a full match.
  const entry = snapshot.values.find((value) =>
    Object.entries(labels).every(
      ([key, expected]) => value.labels?.[key] === expected,
    ),
  );
  return entry?.value ?? 0;
}

describe("PresenceRegistry", () => {
  let redis: Redis | undefined;
  let registry: PresenceRegistry;

  beforeEach(async () => {
    clearRedisClientsForTests();
    registry = await PresenceRegistry.create({
      ...TEST_REALTIME_CONFIG,
      redisUrl: undefined,
      heartbeatGraceMs: 30000,
      replayCacheTtlMs: 60000,
      replayCacheMaxMessages: 100,
    });
    redis = (
      await getRedisClients({
        ...TEST_REALTIME_CONFIG,
        redisUrl: undefined,
        heartbeatGraceMs: 30000,
        replayCacheTtlMs: 60000,
        replayCacheMaxMessages: 100,
      })
    ).presenceClient;
  });

  afterEach(async () => {
    if (redis && typeof redis.quit === "function") {
      await redis.quit();
    }
    clearRedisClientsForTests();
  });

  it("registers and queries presence", async () => {
    await registry.registerConnection("user-1", "socket-1", { agent: "jest" });
    const who = await registry.whoIs("user-1");
    expect(who?.isOnline).toBe(true);
    expect(who?.sockets[0]?.socketId).toBe("socket-1");
    const sockets = await registry.socketsOf("user-1");
    expect(sockets).toEqual(["socket-1"]);
    expect(await registry.isOnline("user-1")).toBe(true);
  });

  it("extends heartbeat and maintains TTL", async () => {
    await registry.registerConnection("user-2", "socket-2", { agent: "jest" });
    await registry.extendHeartbeat("user-2", "socket-2");
    const ttl = await redis!.pttl(
      `${TEST_REALTIME_CONFIG.redisKeyPrefix}:presence:user-2`,
    );
    expect(ttl).toBeGreaterThan(0);
  });

  it("unregisters and emits offline when last socket disconnects", async () => {
    await registry.registerConnection("user-3", "socket-a", { agent: "jest" });
    await registry.registerConnection("user-3", "socket-b", { agent: "jest" });
    await registry.unregister("user-3", "socket-a");
    expect(await registry.isOnline("user-3")).toBe(true);
    await registry.unregister("user-3", "socket-b");
    expect(await registry.isOnline("user-3")).toBe(false);
  });

  it("tracks telemetry counters", async () => {
    const connectStart = await getMetricValue("registry_write_total", {
      event: "connect",
    });
    const disconnectStart = await getMetricValue("registry_write_total", {
      event: "disconnect",
    });
    const heartbeatStart = await getMetricValue("heartbeat_extend_total", {
      event: "success",
    });

    await registry.registerConnection("user-telemetry", "socket-telemetry", {
      agent: "jest",
    });
    await registry.extendHeartbeat("user-telemetry", "socket-telemetry");
    await registry.unregister("user-telemetry", "socket-telemetry");

    expect(
      await getMetricValue("registry_write_total", { event: "connect" }),
    ).toBe(connectStart + 1);
    expect(
      await getMetricValue("registry_write_total", { event: "disconnect" }),
    ).toBe(disconnectStart + 1);
    expect(
      await getMetricValue("heartbeat_extend_total", { event: "success" }),
    ).toBe(heartbeatStart + 1);
  });
});
