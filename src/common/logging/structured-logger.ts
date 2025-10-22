import { randomUUID } from "crypto";
import { getEnv } from "../../config/environment";

type LogLevel = "INFO" | "WARN" | "ERROR";

type SanitizedData = Record<string, unknown>;

interface LogError {
  readonly code?: string;
  readonly message: string;
  readonly stack?: string;
}

export interface LogOptions {
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly userId?: string;
  readonly conversationId?: string;
  readonly endpoint?: string;
  readonly durationMs?: number;
  readonly status?: string | number;
  readonly data?: Record<string, unknown>;
  readonly error?: LogError;
}

const SERVICE_NAME = "chat-backend";
const LOG_SCHEMA_VERSION = "2025-10-22";
const MAX_STRING_LENGTH = 256;
const SAFE_DATA_KEYS = new Set([
  "ip",
  "userAgent",
  "platform",
  "appVersion",
  "method",
  "url",
  "statusCode",
  "socketId",
  "reason",
  "detailCode",
  "transport",
  "retryCount",
  "attempt",
  "messageId",
  "messageIds",
  "messageCount",
  "attachmentCount",
  "conversationId",
  "durationMs",
  "status",
]);
const SENSITIVE_KEY_MARKERS = [
  "token",
  "secret",
  "authorization",
  "password",
  "cookie",
  "session",
];
const SAMPLED_EVENTS = new Map<string, number>([
  ["http.request", 0.05],
  ["http.response", 0.05],
  ["socket.handshake", 0.2],
  ["socket.connection", 0.1],
]);

function sanitizeString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) {
    return value;
  }
  return `${value.substring(0, MAX_STRING_LENGTH)}…`;
}

function sanitizeData(
  data: Record<string, unknown> | undefined,
): SanitizedData | undefined {
  if (!data) {
    return undefined;
  }

  const sanitizedEntries: [string, unknown][] = [];

  for (const [key, rawValue] of Object.entries(data)) {
    if (rawValue === undefined || rawValue === null) {
      continue;
    }

    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEY_MARKERS.some((marker) => lowerKey.includes(marker))) {
      sanitizedEntries.push([key, "[REDACTED]"]);
      continue;
    }

    if (!SAFE_DATA_KEYS.has(key)) {
      continue;
    }

    if (typeof rawValue === "string") {
      sanitizedEntries.push([key, sanitizeString(rawValue)]);
      continue;
    }

    if (Array.isArray(rawValue)) {
      const truncated = rawValue
        .slice(0, 25)
        .map((item) =>
          typeof item === "string" ? sanitizeString(item) : item,
        );
      sanitizedEntries.push([key, truncated]);
      continue;
    }

    if (typeof rawValue === "number" || typeof rawValue === "boolean") {
      sanitizedEntries.push([key, rawValue]);
      continue;
    }
  }

  if (sanitizedEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(sanitizedEntries);
}

function sanitizeError(
  error: LogError | undefined,
  includeStack: boolean,
): LogError | undefined {
  if (!error) {
    return undefined;
  }

  return {
    code: error.code,
    message: sanitizeString(error.message),
    stack:
      includeStack && error.stack ? sanitizeString(error.stack) : undefined,
  };
}

function stripUndefined(
  entry: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entry).filter(([, value]) => value !== undefined),
  );
}

function shouldSample(
  level: LogLevel,
  event: string,
  options: LogOptions,
): boolean {
  if (level !== "INFO") {
    return false;
  }

  if (
    typeof options.status === "string" &&
    options.status !== "accepted" &&
    options.status !== "success"
  ) {
    return false;
  }

  const rate = SAMPLED_EVENTS.get(event);
  if (!rate) {
    return false;
  }

  return Math.random() > rate;
}

export class StructuredLogger {
  static generateCorrelationId(): string {
    return randomUUID();
  }

  static info(event: string, options: LogOptions = {}): void {
    this.log("INFO", event, options);
  }

  static warn(event: string, options: LogOptions = {}): void {
    this.log("WARN", event, options);
  }

  static error(event: string, options: LogOptions = {}): void {
    this.log("ERROR", event, options);
  }

  private static log(
    level: LogLevel,
    event: string,
    options: LogOptions,
  ): void {
    if (shouldSample(level, event, options)) {
      return;
    }

    const env = getEnv();
    const includeStack = env.service.nodeEnv !== "production";

    const entry = stripUndefined({
      ts: new Date().toISOString(),
      level,
      schemaVersion: LOG_SCHEMA_VERSION,
      service: SERVICE_NAME,
      env: env.service.nodeEnv,
      version: env.service.configVersion,
      event,
      requestId: options.requestId,
      correlationId: options.correlationId ?? env.service.configCorrelationId,
      userId: options.userId,
      conversationId: options.conversationId,
      endpoint: options.endpoint,
      durationMs: options.durationMs,
      status: options.status,
      data: sanitizeData(options.data),
      error: sanitizeError(options.error, includeStack),
    });

    const serialized = JSON.stringify(entry);

    switch (level) {
      case "ERROR":
        console.error(serialized);
        break;
      case "WARN":
        console.warn(serialized);
        break;
      default:
        console.log(serialized);
        break;
    }
  }
}
