import { randomUUID } from "crypto";
import { clearRedisClientsForTests } from "../realtime/redis-manager";

export type EnvironmentMode = "development" | "test" | "production";
export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";
export type Sensitivity = "public" | "internal" | "secret";

const CONFIG_VERSION = "2025-10-22";
const KNOWN_RUNTIME_MODULES = new Set(["chat"]);

export interface EnvVarMetadata {
  readonly key: string;
  readonly category:
    | "service"
    | "auth"
    | "database"
    | "telemetry"
    | "forbidden";
  readonly description: string;
  readonly required: boolean;
  readonly defaultValue?: string;
  readonly allowed?: readonly string[];
  readonly sensitivity: Sensitivity;
  readonly example?: string;
}

export const ENVIRONMENT_VARIABLES: readonly EnvVarMetadata[] = [
  {
    key: "NODE_ENV",
    category: "service",
    description: "Deployment mode controlling safety guards and logging",
    required: false,
    defaultValue: "development",
    allowed: ["development", "test", "production"],
    sensitivity: "public",
    example: "production",
  },
  {
    key: "PORT",
    category: "service",
    description: "HTTP listening port",
    required: false,
    defaultValue: "3001",
    sensitivity: "public",
    example: "8080",
  },
  {
    key: "LOG_LEVEL",
    category: "service",
    description: "Log verbosity (piped to transport logger)",
    required: false,
    defaultValue: "info",
    allowed: ["fatal", "error", "warn", "info", "debug", "trace"],
    sensitivity: "public",
    example: "warn",
  },
  {
    key: "ACTIVE_MODULE",
    category: "service",
    description: "Selected runtime module variant (must be allowlisted)",
    required: false,
    defaultValue: "chat",
    sensitivity: "internal",
    example: "chat",
  },
  {
    key: "ALLOWED_MODULES",
    category: "service",
    description: "Comma-separated module allowlist",
    required: false,
    defaultValue: "chat",
    sensitivity: "internal",
    example: "app,chat,read-model",
  },
  {
    key: "CORS_ORIGIN",
    category: "service",
    description: "Comma-separated list of allowed origins",
    required: false,
    sensitivity: "public",
    example: "https://admin.example.com,https://chat.example.com",
  },
  {
    key: "SOCKET_ADAPTER_ENABLED",
    category: "service",
    description: "Enable the Redis-backed Socket.IO adapter",
    required: false,
    defaultValue: "false",
    sensitivity: "internal",
    example: "true",
  },
  {
    key: "SOCKET_REDIS_URL",
    category: "service",
    description: "Redis connection URL for socket fanout and presence registry",
    required: false,
    sensitivity: "secret",
    example: "rediss://user:******@redis.internal:6380/0",
  },
  {
    key: "SOCKET_REDIS_USERNAME",
    category: "service",
    description: "Redis username when ACL authentication is enabled",
    required: false,
    sensitivity: "secret",
  },
  {
    key: "SOCKET_REDIS_PASSWORD",
    category: "service",
    description: "Redis password or access token",
    required: false,
    sensitivity: "secret",
  },
  {
    key: "SOCKET_REDIS_TLS",
    category: "service",
    description: "Enable TLS for Redis adapter connections",
    required: false,
    defaultValue: "false",
    sensitivity: "internal",
    example: "true",
  },
  {
    key: "SOCKET_REDIS_KEY_PREFIX",
    category: "service",
    description: "Key prefix namespace for socket presence data",
    required: false,
    sensitivity: "internal",
    example: "chat",
  },
  {
    key: "SOCKET_INSTANCE_ID",
    category: "service",
    description: "Unique identifier for this runtime instance",
    required: false,
    sensitivity: "internal",
    example: "chat-api-01",
  },
  {
    key: "SOCKET_HEARTBEAT_INTERVAL_MS",
    category: "service",
    description: "Heartbeat interval used to extend Redis TTL for live sockets",
    required: false,
    defaultValue: "15000",
    sensitivity: "internal",
    example: "20000",
  },
  {
    key: "SOCKET_PRESENCE_TTL_MS",
    category: "service",
    description: "TTL for presence keys; must exceed the heartbeat interval",
    required: false,
    defaultValue: "45000",
    sensitivity: "internal",
    example: "60000",
  },
  {
    key: "JWT_ISSUER",
    category: "auth",
    description: "Expected token issuer claim",
    required: true,
    sensitivity: "internal",
    example: "https://identity.example.com/issuer",
  },
  {
    key: "JWT_AUDIENCE",
    category: "auth",
    description: "Expected token audience claim",
    required: true,
    sensitivity: "internal",
    example: "chat-backend",
  },
  {
    key: "JWKS_URL",
    category: "auth",
    description: "Remote JWKS endpoint for signature verification",
    required: false,
    sensitivity: "internal",
    example: "https://identity.example.com/.well-known/jwks.json",
  },
  {
    key: "PUBLIC_KEYS",
    category: "auth",
    description: "Static PEM or shared-secret keys (newline or '||' delimited)",
    required: false,
    sensitivity: "secret",
    example: "-----BEGIN PUBLIC KEY-----…",
  },
  {
    key: "TOKEN_LEEWAY_SEC",
    category: "auth",
    description: "Clock skew tolerance applied to JWT validation (seconds)",
    required: false,
    defaultValue: "30",
    sensitivity: "internal",
    example: "20",
  },
  {
    key: "DATABASE_URL",
    category: "database",
    description: "Primary database connection string",
    required: true,
    sensitivity: "secret",
    example: "postgresql://app:******@db.internal:5432/chat",
  },
  {
    key: "DB_POOL_MIN",
    category: "database",
    description: "Minimum Prisma connection pool size",
    required: false,
    sensitivity: "internal",
    example: "4",
  },
  {
    key: "DB_POOL_MAX",
    category: "database",
    description: "Maximum Prisma connection pool size",
    required: false,
    sensitivity: "internal",
    example: "20",
  },
  {
    key: "DB_CONNECTION_TIMEOUT_MS",
    category: "database",
    description: "Database connection timeout in milliseconds",
    required: false,
    sensitivity: "internal",
    example: "10000",
  },
  {
    key: "DB_IDLE_TIMEOUT_MS",
    category: "database",
    description: "Idle connection timeout in milliseconds",
    required: false,
    sensitivity: "internal",
    example: "5000",
  },
  {
    key: "METRICS_ENABLED",
    category: "telemetry",
    description: "Enable metrics endpoint and socket counters",
    required: false,
    defaultValue: "false",
    sensitivity: "internal",
  },
  {
    key: "METRICS_PORT",
    category: "telemetry",
    description: "Prometheus scrape port when METRICS_ENABLED=true",
    required: false,
    defaultValue: "9464",
    sensitivity: "internal",
  },
  {
    key: "LOG_JSON",
    category: "telemetry",
    description: "Emit structured JSON logs",
    required: false,
    defaultValue: "true",
    sensitivity: "internal",
  },
  {
    key: "TRACE_ENABLED",
    category: "telemetry",
    description: "Enable distributed tracing exports",
    required: false,
    defaultValue: "false",
    sensitivity: "internal",
  },
  {
    key: "SOCKET_REDIS_MOCK",
    category: "forbidden",
    description:
      "Use the in-memory Redis mock for adapter testing (non-production only)",
    required: false,
    defaultValue: "false",
    sensitivity: "internal",
  },
  {
    key: "DISABLE_RATE_LIMIT",
    category: "forbidden",
    description: "Disables HTTP rate limiting (for load testing only)",
    required: false,
    defaultValue: "false",
    sensitivity: "internal",
  },
  {
    key: "MOCK_MODE",
    category: "forbidden",
    description: "Enables mock Prisma client (non-production)",
    required: false,
    defaultValue: "false",
    sensitivity: "internal",
  },
  {
    key: "DEV_SEED_DATA",
    category: "forbidden",
    description: "Auto seed developer fixtures at startup",
    required: false,
    defaultValue: "false",
    sensitivity: "internal",
  },
] as const;

export interface EnvironmentConfig {
  readonly service: {
    readonly nodeEnv: EnvironmentMode;
    readonly port: number;
    readonly logLevel: LogLevel;
    readonly configVersion: string;
    readonly configCorrelationId: string;
    readonly activeModule: string;
    readonly allowedModules: readonly string[];
    readonly corsOrigins: readonly string[];
  };
  readonly auth: {
    readonly jwtIssuer: string;
    readonly jwtAudience: string;
    readonly jwksUrl?: string;
    readonly publicKeys: readonly string[];
    readonly tokenLeewaySec: number;
  };
  readonly database: {
    readonly url: string;
    readonly poolMin?: number;
    readonly poolMax?: number;
    readonly connectionTimeoutMs?: number;
    readonly idleTimeoutMs?: number;
  };
  readonly telemetry: {
    readonly metricsEnabled: boolean;
    readonly metricsPort: number;
    readonly logJson: boolean;
    readonly traceEnabled: boolean;
  };
  readonly realtime: {
    readonly adapterEnabled: boolean;
    readonly redisUrl?: string;
    readonly redisUsername?: string;
    readonly redisPassword?: string;
    readonly redisTls: boolean;
    readonly redisKeyPrefix: string;
    readonly useMockRedis: boolean;
    readonly instanceId: string;
    readonly heartbeatIntervalMs: number;
    readonly heartbeatGraceMs: number;
    readonly presenceTtlMs: number;
    readonly replayCacheTtlMs: number;
    readonly replayCacheMaxMessages: number;
  };
  readonly flags: {
    readonly disableRateLimit: boolean;
    readonly mockMode: boolean;
    readonly devSeedData: boolean;
  };
}

class EnvValidationError extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(`Environment validation failed: ${reasons.join("; ")}`);
    this.name = "EnvValidationError";
  }
}

const TRUE_VALUES = new Set(["1", "true", "t", "yes", "y", "on"]);
const FALSE_VALUES = new Set(["0", "false", "f", "no", "n", "off"]);
const LOG_LEVELS: readonly LogLevel[] = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
];

let cachedConfig: EnvironmentConfig | null = null;
let resolvedConfigLogged = false;

function normalizeKeyList(
  raw: string | undefined,
  fallback: string[],
): string[] {
  const source = raw ?? fallback.join(",");

  if (!source) {
    return [];
  }

  const seen = new Set<string>();

  return source
    .split(/[,|]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => {
      if (seen.has(entry)) {
        return false;
      }
      seen.add(entry);
      return true;
    });
}

function parseBoolean(
  value: string | undefined,
  defaultValue: boolean,
  key: string,
  errors: string[],
): boolean {
  if (value === undefined || value === "") {
    return defaultValue;
  }

  const normalized = value.toLowerCase().trim();

  if (TRUE_VALUES.has(normalized)) {
    return true;
  }

  if (FALSE_VALUES.has(normalized)) {
    return false;
  }

  errors.push(`${key} must be a boolean-like value (true/false)`);
  return defaultValue;
}

function parseNumber(
  value: string | undefined,
  key: string,
  errors: string[],
  options: {
    min?: number;
    max?: number;
    defaultValue?: number;
    integer?: boolean;
  },
): number | undefined {
  if (value === undefined || value === "") {
    return options.defaultValue;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    errors.push(`${key} must be a valid number`);
    return options.defaultValue;
  }

  if (options.integer && !Number.isInteger(parsed)) {
    errors.push(`${key} must be an integer`);
    return options.defaultValue;
  }

  if (options.min !== undefined && parsed < options.min) {
    errors.push(`${key} must be >= ${options.min}`);
  }

  if (options.max !== undefined && parsed > options.max) {
    errors.push(`${key} must be <= ${options.max}`);
  }

  return parsed;
}

function maskSecret(value: string | undefined): string | undefined {
  if (!value) {
    return value;
  }
  if (value.length <= 6) {
    return "***";
  }
  return `${value.slice(0, 3)}***${value.slice(-2)}`;
}

function parsePublicKeys(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  const segments = raw
    .split(/(?:\n{2,}|\|\||;;)/)
    .flatMap((segment) => segment.split(/(?=-----BEGIN)/))
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length > 0) {
    return segments;
  }

  // Treat as single-line shared secret
  return [raw.trim()];
}

export function loadEnvironment(
  overrides?: Record<string, string | undefined>,
): EnvironmentConfig {
  if (!overrides && cachedConfig) {
    return cachedConfig;
  }

  const source = { ...process.env, ...overrides } as Record<
    string,
    string | undefined
  >;
  const errors: string[] = [];

  const nodeEnvRaw = source.NODE_ENV?.trim().toLowerCase();
  const nodeEnv: EnvironmentMode = ((): EnvironmentMode => {
    if (!nodeEnvRaw || nodeEnvRaw.length === 0) {
      return "development";
    }
    if (["development", "test", "production"].includes(nodeEnvRaw)) {
      return nodeEnvRaw as EnvironmentMode;
    }
    errors.push(
      `NODE_ENV must be development|test|production (received: ${source.NODE_ENV})`,
    );
    return "development";
  })();

  const port =
    parseNumber(source.PORT, "PORT", errors, {
      min: 1024,
      max: 65535,
      integer: true,
      defaultValue: 3001,
    }) ?? 3001;

  const logLevelRaw = source.LOG_LEVEL?.trim().toLowerCase();
  const logLevel: LogLevel = ((): LogLevel => {
    if (!logLevelRaw) {
      return "info";
    }
    if (LOG_LEVELS.includes(logLevelRaw as LogLevel)) {
      return logLevelRaw as LogLevel;
    }
    errors.push(
      `LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")} (received: ${source.LOG_LEVEL})`,
    );
    return "info";
  })();

  const jwtIssuer = source.JWT_ISSUER?.trim();
  if (!jwtIssuer) {
    errors.push("JWT_ISSUER is required");
  }

  const jwtAudience = source.JWT_AUDIENCE?.trim();
  if (!jwtAudience) {
    errors.push("JWT_AUDIENCE is required");
  }

  const jwksUrl = source.JWKS_URL?.trim() || undefined;
  const publicKeys = parsePublicKeys(source.PUBLIC_KEYS);

  if (!jwksUrl && publicKeys.length === 0) {
    errors.push("Provide JWKS_URL or PUBLIC_KEYS for token verification");
  }

  const tokenLeewaySec =
    parseNumber(source.TOKEN_LEEWAY_SEC, "TOKEN_LEEWAY_SEC", errors, {
      min: 0,
      max: 120,
      integer: true,
      defaultValue: 30,
    }) ?? 30;

  const databaseUrl = source.DATABASE_URL?.trim();
  if (!databaseUrl) {
    errors.push("DATABASE_URL is required");
  }

  const poolMin = parseNumber(source.DB_POOL_MIN, "DB_POOL_MIN", errors, {
    integer: true,
    min: 0,
  });
  const poolMax = parseNumber(source.DB_POOL_MAX, "DB_POOL_MAX", errors, {
    integer: true,
    min: 1,
  });

  if (poolMin !== undefined && poolMax !== undefined && poolMin > poolMax) {
    errors.push("DB_POOL_MIN cannot exceed DB_POOL_MAX");
  }

  const connectionTimeoutMs = parseNumber(
    source.DB_CONNECTION_TIMEOUT_MS,
    "DB_CONNECTION_TIMEOUT_MS",
    errors,
    { integer: true, min: 1000 },
  );
  const idleTimeoutMs = parseNumber(
    source.DB_IDLE_TIMEOUT_MS,
    "DB_IDLE_TIMEOUT_MS",
    errors,
    {
      integer: true,
      min: 1000,
    },
  );

  const metricsEnabled = parseBoolean(
    source.METRICS_ENABLED,
    false,
    "METRICS_ENABLED",
    errors,
  );
  const metricsPort =
    parseNumber(source.METRICS_PORT, "METRICS_PORT", errors, {
      min: 1024,
      max: 65535,
      integer: true,
      defaultValue: 9464,
    }) ?? 9464;
  const logJson = parseBoolean(
    source.LOG_JSON ?? "true",
    true,
    "LOG_JSON",
    errors,
  );
  const traceEnabled = parseBoolean(
    source.TRACE_ENABLED,
    false,
    "TRACE_ENABLED",
    errors,
  );

  const adapterEnabled = parseBoolean(
    source.SOCKET_ADAPTER_ENABLED,
    false,
    "SOCKET_ADAPTER_ENABLED",
    errors,
  );

  const redisUrl = source.SOCKET_REDIS_URL?.trim();
  const redisUsername = source.SOCKET_REDIS_USERNAME?.trim() || undefined;
  const redisPassword = source.SOCKET_REDIS_PASSWORD?.trim() || undefined;
  const redisTls = parseBoolean(
    source.SOCKET_REDIS_TLS,
    false,
    "SOCKET_REDIS_TLS",
    errors,
  );
  const redisKeyPrefix = source.SOCKET_REDIS_KEY_PREFIX?.trim() || "presence";

  const heartbeatIntervalMs =
    parseNumber(
      source.SOCKET_HEARTBEAT_INTERVAL_MS,
      "SOCKET_HEARTBEAT_INTERVAL_MS",
      errors,
      {
        min: 1000,
        max: 120000,
        integer: true,
        defaultValue: 25000,
      },
    ) ?? 25000;

  const heartbeatGraceMs =
    parseNumber(
      source.SOCKET_HEARTBEAT_GRACE_MS,
      "SOCKET_HEARTBEAT_GRACE_MS",
      errors,
      {
        min: heartbeatIntervalMs,
        max: Math.max(heartbeatIntervalMs * 3, heartbeatIntervalMs + 1000),
        integer: true,
        defaultValue: heartbeatIntervalMs,
      },
    ) ?? heartbeatIntervalMs;

  const presenceTtlMs =
    parseNumber(
      source.SOCKET_PRESENCE_TTL_MS,
      "SOCKET_PRESENCE_TTL_MS",
      errors,
      {
        min: heartbeatIntervalMs + heartbeatGraceMs + 1000,
        max: 300000,
        integer: true,
        defaultValue: Math.max(
          heartbeatIntervalMs * 2,
          heartbeatIntervalMs + heartbeatGraceMs + 1000,
        ),
      },
    ) ??
    Math.max(
      heartbeatIntervalMs * 2,
      heartbeatIntervalMs + heartbeatGraceMs + 1000,
    );

  if (presenceTtlMs <= heartbeatIntervalMs) {
    errors.push(
      "SOCKET_PRESENCE_TTL_MS must be greater than SOCKET_HEARTBEAT_INTERVAL_MS",
    );
  }

  const replayCacheTtlMs =
    parseNumber(
      source.SOCKET_REPLAY_CACHE_TTL_MS,
      "SOCKET_REPLAY_CACHE_TTL_MS",
      errors,
      {
        min: Math.max(heartbeatIntervalMs + heartbeatGraceMs, 60_000),
        max: 3_600_000,
        integer: true,
        defaultValue: 300_000,
      },
    ) ?? 300_000;

  const replayCacheMaxMessages =
    parseNumber(
      source.SOCKET_REPLAY_CACHE_MAX_MESSAGES,
      "SOCKET_REPLAY_CACHE_MAX_MESSAGES",
      errors,
      {
        min: 50,
        max: 2000,
        integer: true,
        defaultValue: 500,
      },
    ) ?? 500;

  const useMockRedis = parseBoolean(
    source.SOCKET_REDIS_MOCK,
    nodeEnv === "test",
    "SOCKET_REDIS_MOCK",
    errors,
  );

  const instanceId = (() => {
    const explicit =
      source.SOCKET_INSTANCE_ID?.trim() ||
      process.env.INSTANCE_ID?.trim() ||
      process.env.HOSTNAME?.trim();
    if (explicit) {
      return explicit;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const os = require("os") as typeof import("os");
      return os.hostname();
    } catch (error) {
      void error;
      return `pid-${process.pid}`;
    }
  })();

  if (adapterEnabled && !redisUrl) {
    errors.push(
      "SOCKET_REDIS_URL is required when SOCKET_ADAPTER_ENABLED=true",
    );
  }

  if (nodeEnv === "production") {
    if (!adapterEnabled) {
      errors.push("SOCKET_ADAPTER_ENABLED must be true in production");
    }
    if (useMockRedis) {
      errors.push("SOCKET_REDIS_MOCK cannot be enabled in production");
    }
  }

  if (adapterEnabled && useMockRedis && nodeEnv === "production") {
    errors.push(
      "SOCKET_REDIS_MOCK cannot be used when SOCKET_ADAPTER_ENABLED=true in production",
    );
  }

  const disableRateLimit = parseBoolean(
    source.DISABLE_RATE_LIMIT,
    false,
    "DISABLE_RATE_LIMIT",
    errors,
  );
  const mockMode = parseBoolean(source.MOCK_MODE, false, "MOCK_MODE", errors);
  const devSeedData = parseBoolean(
    source.DEV_SEED_DATA,
    false,
    "DEV_SEED_DATA",
    errors,
  );

  const allowedModules = normalizeKeyList(source.ALLOWED_MODULES, ["chat"]);
  const activeModule =
    source.ACTIVE_MODULE?.trim() || allowedModules[0] || "chat";

  if (allowedModules.length === 0) {
    errors.push("ALLOWED_MODULES must contain at least one module name");
  }

  const unrecognizedModules = allowedModules.filter(
    (moduleName) => !KNOWN_RUNTIME_MODULES.has(moduleName),
  );
  if (unrecognizedModules.length > 0) {
    errors.push(
      `ALLOWED_MODULES contains unsupported modules: ${unrecognizedModules.join(", ")}. Supported modules: ${Array.from(
        KNOWN_RUNTIME_MODULES,
      ).join(", ")}`,
    );
  }

  if (!allowedModules.includes(activeModule)) {
    errors.push(
      `ACTIVE_MODULE (${activeModule}) must be included in ALLOWED_MODULES (${allowedModules.join(", ")})`,
    );
  }

  if (!KNOWN_RUNTIME_MODULES.has(activeModule)) {
    errors.push(
      `ACTIVE_MODULE (${activeModule}) is not supported. Supported modules: ${Array.from(
        KNOWN_RUNTIME_MODULES,
      ).join(", ")}`,
    );
  }

  if (nodeEnv === "production") {
    const nonChatModules = allowedModules.filter(
      (moduleName) => moduleName !== "chat",
    );
    if (nonChatModules.length > 0) {
      errors.push(
        `ALLOWED_MODULES contains non-chat modules (${nonChatModules.join(", ")}) which are forbidden when NODE_ENV=production`,
      );
    }

    if (activeModule !== "chat") {
      errors.push(
        `ACTIVE_MODULE must be "chat" when NODE_ENV=production (received "${activeModule}")`,
      );
    }
  }

  if (nodeEnv === "production") {
    const forbiddenFlags: string[] = [];
    if (disableRateLimit) forbiddenFlags.push("DISABLE_RATE_LIMIT");
    if (mockMode) forbiddenFlags.push("MOCK_MODE");
    if (devSeedData) forbiddenFlags.push("DEV_SEED_DATA");

    if (forbiddenFlags.length > 0) {
      errors.push(
        `Forbidden flags ${forbiddenFlags.join(", ")} cannot be enabled in production`,
      );
    }
  }

  const corsOrigins = normalizeKeyList(source.CORS_ORIGIN, []);

  if (errors.length > 0) {
    throw new EnvValidationError(errors);
  }

  const configCorrelationId = randomUUID();

  const config: EnvironmentConfig = {
    service: {
      nodeEnv,
      port,
      logLevel,
      configVersion: CONFIG_VERSION,
      configCorrelationId,
      activeModule,
      allowedModules,
      corsOrigins,
    },
    auth: {
      jwtIssuer: jwtIssuer!,
      jwtAudience: jwtAudience!,
      jwksUrl,
      publicKeys,
      tokenLeewaySec,
    },
    database: {
      url: databaseUrl!,
      poolMin: poolMin ?? undefined,
      poolMax: poolMax ?? undefined,
      connectionTimeoutMs: connectionTimeoutMs ?? undefined,
      idleTimeoutMs: idleTimeoutMs ?? undefined,
    },
    telemetry: {
      metricsEnabled,
      metricsPort,
      logJson,
      traceEnabled,
    },
    realtime: {
      adapterEnabled,
      redisUrl: redisUrl ?? undefined,
      redisUsername,
      redisPassword,
      redisTls,
      redisKeyPrefix,
      useMockRedis,
      instanceId,
      heartbeatIntervalMs,
      heartbeatGraceMs,
      presenceTtlMs,
      replayCacheTtlMs,
      replayCacheMaxMessages,
    },
    flags: {
      disableRateLimit,
      mockMode,
      devSeedData,
    },
  };

  cachedConfig = config;
  emitResolvedConfigLog(config);

  return config;
}

export function getEnv(): EnvironmentConfig {
  if (!cachedConfig) {
    cachedConfig = loadEnvironment();
  }
  return cachedConfig;
}

export function resetEnvironmentCacheForTests(): void {
  cachedConfig = null;
  resolvedConfigLogged = false;
  clearRedisClientsForTests();
}

function emitResolvedConfigLog(config: EnvironmentConfig): void {
  if (resolvedConfigLogged) {
    return;
  }

  const payload = {
    event: "resolvedConfig",
    version: config.service.configVersion,
    correlationId: config.service.configCorrelationId,
    timestamp: new Date().toISOString(),
    service: {
      nodeEnv: config.service.nodeEnv,
      port: config.service.port,
      logLevel: config.service.logLevel,
      activeModule: config.service.activeModule,
      allowedModules: config.service.allowedModules,
      corsOrigins: config.service.corsOrigins,
    },
    auth: {
      jwtIssuer: config.auth.jwtIssuer,
      jwtAudience: config.auth.jwtAudience,
      jwksUrl: config.auth.jwksUrl
        ? maskSecret(config.auth.jwksUrl)
        : undefined,
      publicKeyCount: config.auth.publicKeys.length,
      tokenLeewaySec: config.auth.tokenLeewaySec,
    },
    database: {
      url: maskSecret(config.database.url),
      poolMin: config.database.poolMin,
      poolMax: config.database.poolMax,
      connectionTimeoutMs: config.database.connectionTimeoutMs,
      idleTimeoutMs: config.database.idleTimeoutMs,
    },
    telemetry: config.telemetry,
    realtime: {
      adapterEnabled: config.realtime.adapterEnabled,
      redisUrl: maskSecret(config.realtime.redisUrl),
      redisTls: config.realtime.redisTls,
      redisKeyPrefix: config.realtime.redisKeyPrefix,
      useMockRedis: config.realtime.useMockRedis,
      instanceId: config.realtime.instanceId,
      heartbeatIntervalMs: config.realtime.heartbeatIntervalMs,
      heartbeatGraceMs: config.realtime.heartbeatGraceMs,
      presenceTtlMs: config.realtime.presenceTtlMs,
      replayCacheTtlMs: config.realtime.replayCacheTtlMs,
      replayCacheMaxMessages: config.realtime.replayCacheMaxMessages,
    },
    flags: config.flags,
  };

  console.info(JSON.stringify(payload));
  resolvedConfigLogged = true;
}

export { EnvValidationError };
