import type { Redis, RedisOptions } from "ioredis";
import RedisClient from "ioredis";
import { StructuredLogger } from "../common/logging/structured-logger";
import type { EnvironmentConfig } from "../config/environment";
import { TelemetryMetrics } from "../observability/metrics-registry";

type RealtimeConfig = EnvironmentConfig["realtime"];

type AdapterClients = {
  readonly pubClient: Redis;
  readonly subClient: Redis;
  readonly presenceClient: Redis;
};

let cachedClients: AdapterClients | null = null;
let cachedConfigKey: string | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

const CONFIG_MASK_KEYS: (keyof RealtimeConfig)[] = [
  "redisUrl",
  "redisKeyPrefix",
  "redisTls",
  "adapterEnabled",
  "useMockRedis",
  "heartbeatIntervalMs",
  "heartbeatGraceMs",
  "presenceTtlMs",
  "replayCacheTtlMs",
  "replayCacheMaxMessages",
  "instanceId",
];

function serializeConfigKey(config: RealtimeConfig): string {
  return JSON.stringify({
    url: config.redisUrl,
    prefix: config.redisKeyPrefix,
    tls: config.redisTls,
    mock: config.useMockRedis,
    instanceId: config.instanceId,
  });
}

async function ensureHeartbeat(
  client: Redis,
  config: RealtimeConfig,
): Promise<void> {
  if (heartbeatTimer) {
    return;
  }

  const interval = Math.max(config.heartbeatIntervalMs, 1000);
  heartbeatTimer = setInterval(async () => {
    try {
      await client.ping();
      TelemetryMetrics.recordAdapterHeartbeat(Date.now());
    } catch (error) {
      TelemetryMetrics.recordAdapterError("heartbeat");
      StructuredLogger.error("socket.adapter.heartbeat", {
        status: "failed",
        data: {
          instanceId: config.instanceId,
        },
        error: {
          code: "redis.heartbeat_failed",
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
      });
    }
  }, interval);

  if (heartbeatTimer.unref) {
    heartbeatTimer.unref();
  }
}

function buildRedisOptions(config: RealtimeConfig): RedisOptions {
  const options: RedisOptions = {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    connectTimeout: 10_000,
    enableAutoPipelining: false,
  };

  if (config.redisUrl) {
    options.connectionName = config.instanceId;
  }

  if (config.redisUsername) {
    options.username = config.redisUsername;
  }

  if (config.redisPassword) {
    options.password = config.redisPassword;
  }

  if (config.redisTls) {
    options.tls = {};
  }

  return options;
}

function createRedisClient(config: RealtimeConfig): Redis {
  const options = buildRedisOptions(config);
  const RedisLibrary: typeof RedisClient = config.useMockRedis
    ? // eslint-disable-next-line @typescript-eslint/no-var-requires
      (require("ioredis-mock") as unknown as typeof RedisClient)
    : RedisClient;

  if (config.redisUrl) {
    return new RedisLibrary(config.redisUrl, options) as unknown as Redis;
  }

  return new RedisLibrary(options) as unknown as Redis;
}

async function connectClient(
  client: Redis,
  label: "pub" | "sub" | "presence",
  config: RealtimeConfig,
): Promise<void> {
  try {
    TelemetryMetrics.recordAdapterConnect(`${label}_connecting`);
    if (config.useMockRedis) {
      TelemetryMetrics.recordAdapterConnect(`${label}_connected`);
      return;
    }
    const status = (client as unknown as { status?: string }).status;
    if (status && status !== "wait") {
      TelemetryMetrics.recordAdapterConnect(`${label}_connected`);
      return;
    }
    if (
      typeof (client as unknown as { connect?: () => Promise<void> })
        .connect === "function"
    ) {
      await (client as unknown as { connect: () => Promise<void> }).connect();
    }
    TelemetryMetrics.recordAdapterConnect(`${label}_connected`);
  } catch (error) {
    TelemetryMetrics.recordAdapterError(`${label}_connect_failure`);
    client.disconnect();
    throw error;
  }
}

export async function getRedisClients(
  config: RealtimeConfig,
): Promise<AdapterClients> {
  const key = serializeConfigKey(config);
  if (cachedClients && cachedConfigKey === key) {
    return cachedClients;
  }

  const pubClient = createRedisClient(config);
  const subClient = pubClient.duplicate();
  const presenceClient = pubClient.duplicate();

  pubClient.on("error", (error) => {
    TelemetryMetrics.recordAdapterError("pub_error");
    StructuredLogger.warn("socket.adapter.redis", {
      status: "error",
      data: {
        side: "publisher",
      },
      error: {
        code: "redis.pub_error",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
  });

  subClient.on("error", (error) => {
    TelemetryMetrics.recordAdapterError("sub_error");
    StructuredLogger.warn("socket.adapter.redis", {
      status: "error",
      data: {
        side: "subscriber",
      },
      error: {
        code: "redis.sub_error",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
  });

  presenceClient.on("error", (error) => {
    TelemetryMetrics.recordAdapterError("presence_error");
    StructuredLogger.warn("socket.adapter.redis", {
      status: "error",
      data: {
        side: "presence",
      },
      error: {
        code: "redis.presence_error",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
  });

  try {
    await Promise.all([
      connectClient(pubClient, "pub", config),
      connectClient(subClient, "sub", config),
      connectClient(presenceClient, "presence", config),
    ]);
    await ensureHeartbeat(presenceClient, config);
  } catch (error) {
    pubClient.disconnect();
    subClient.disconnect();
    presenceClient.disconnect();
    throw error;
  }

  cachedClients = { pubClient, subClient, presenceClient };
  cachedConfigKey = key;

  const sanitizedConfig = Object.fromEntries(
    CONFIG_MASK_KEYS.map((maskKey) => [
      maskKey,
      (config as Record<string, unknown>)[maskKey],
    ]),
  );

  StructuredLogger.info("socket.adapter.config", {
    status: "ready",
    data: {
      ...sanitizedConfig,
      redisUrl: config.redisUrl ? maskRedisUrl(config.redisUrl) : undefined,
    },
  });

  return cachedClients;
}

function maskRedisUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const redactedAuth = parsed.username || parsed.password ? "***@" : "";
    return `${parsed.protocol}//${redactedAuth}${parsed.hostname}:${parsed.port || 6379}${parsed.pathname}`;
  } catch (error) {
    void error;
    return "masked";
  }
}

export function clearRedisClientsForTests(): void {
  if (cachedClients) {
    cachedClients.pubClient.disconnect();
    cachedClients.subClient.disconnect();
    cachedClients.presenceClient.disconnect();
  }
  cachedClients = null;
  cachedConfigKey = null;
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}
