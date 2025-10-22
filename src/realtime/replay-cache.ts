import type { Redis } from "ioredis";
import { getRedisClients } from "./redis-manager";
import type { EnvironmentConfig } from "../config/environment";

export type ReplayMessage = {
  readonly id: string;
  readonly conversationId: string;
  readonly createdAt: string;
  readonly [key: string]: unknown;
};

export interface ReplayCache {
  storeMessage(message: ReplayMessage): Promise<void>;
  fetchSince(
    conversationId: string,
    afterMessageId?: string,
  ): Promise<ReplayMessage[]>;
  fetchMessage(messageId: string): Promise<ReplayMessage | null>;
}

const MESSAGE_KEY = (prefix: string, messageId: string): string =>
  `${prefix}:replay:message:${messageId}`;
const CONVERSATION_KEY = (prefix: string, conversationId: string): string =>
  `${prefix}:replay:conversation:${conversationId}`;

function toTimestamp(createdAt: string): number {
  const parsed = Date.parse(createdAt);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

class RedisReplayCache implements ReplayCache {
  private readonly redis: Redis;
  private readonly prefix: string;
  private readonly ttlMs: number;
  private readonly maxMessages: number;

  constructor(redis: Redis, config: EnvironmentConfig["realtime"]) {
    this.redis = redis;
    this.prefix = config.redisKeyPrefix;
    this.ttlMs = config.replayCacheTtlMs;
    this.maxMessages = config.replayCacheMaxMessages;
  }

  async storeMessage(message: ReplayMessage): Promise<void> {
    const timestamp = toTimestamp(message.createdAt);
    const messageKey = MESSAGE_KEY(this.prefix, message.id);
    const conversationKey = CONVERSATION_KEY(
      this.prefix,
      message.conversationId,
    );

    const pipeline = this.redis.multi();
    pipeline.set(messageKey, JSON.stringify(message), "PX", this.ttlMs);
    pipeline.zadd(conversationKey, timestamp, message.id);
    pipeline.zremrangebyscore(conversationKey, 0, timestamp - this.ttlMs);
    pipeline.zremrangebyrank(conversationKey, 0, -this.maxMessages - 1);
    pipeline.pexpire(conversationKey, this.ttlMs);
    await pipeline.exec();
  }

  async fetchSince(
    conversationId: string,
    afterMessageId?: string,
  ): Promise<ReplayMessage[]> {
    const conversationKey = CONVERSATION_KEY(this.prefix, conversationId);
    let minScore = Date.now() - this.ttlMs;

    if (afterMessageId) {
      const origin = await this.fetchMessage(afterMessageId);
      if (origin) {
        minScore = toTimestamp(origin.createdAt) + 1;
      } else {
        // Cursor fell out of cache window. The caller is expected to handle durable fallback.
        return [];
      }
    }

    const messageIds = await this.redis.zrangebyscore(
      conversationKey,
      minScore,
      "+inf",
    );
    if (messageIds.length === 0) {
      return [];
    }

    const pipeline = this.redis.multi();
    for (const id of messageIds) {
      pipeline.get(MESSAGE_KEY(this.prefix, id));
    }
    const results = await pipeline.exec();

    const messages: ReplayMessage[] = [];
    for (const entry of results ?? []) {
      const payload = entry?.[1];
      if (!payload || typeof payload !== "string") {
        continue;
      }
      try {
        const parsed = JSON.parse(payload) as ReplayMessage;
        if (parsed && typeof parsed.id === "string") {
          if (parsed.id === afterMessageId) {
            continue;
          }
          messages.push(parsed);
        }
      } catch (error) {
        void error;
      }
    }

    messages.sort(
      (a, b) => toTimestamp(a.createdAt) - toTimestamp(b.createdAt),
    );
    return messages;
  }

  async fetchMessage(messageId: string): Promise<ReplayMessage | null> {
    const payload = await this.redis.get(MESSAGE_KEY(this.prefix, messageId));
    if (!payload) {
      return null;
    }
    try {
      const parsed = JSON.parse(payload) as ReplayMessage;
      return parsed ?? null;
    } catch (error) {
      void error;
      return null;
    }
  }
}

interface InMemoryEntry {
  readonly message: ReplayMessage;
  readonly storedAt: number;
}

class InMemoryReplayCache implements ReplayCache {
  private readonly buckets = new Map<string, InMemoryEntry[]>();
  private readonly ttlMs: number;
  private readonly maxMessages: number;

  constructor(config: EnvironmentConfig["realtime"]) {
    this.ttlMs = config.replayCacheTtlMs;
    this.maxMessages = config.replayCacheMaxMessages;
  }

  async storeMessage(message: ReplayMessage): Promise<void> {
    const entries = this.buckets.get(message.conversationId) ?? [];
    const now = Date.now();
    const filtered = entries.filter(
      (entry) => now - entry.storedAt < this.ttlMs,
    );
    filtered.push({ message, storedAt: now });
    if (filtered.length > this.maxMessages) {
      filtered.splice(0, filtered.length - this.maxMessages);
    }
    this.buckets.set(message.conversationId, filtered);
  }

  async fetchSince(
    conversationId: string,
    afterMessageId?: string,
  ): Promise<ReplayMessage[]> {
    const entries = this.buckets.get(conversationId) ?? [];
    const now = Date.now();
    const fresh = entries.filter((entry) => now - entry.storedAt < this.ttlMs);

    let startIndex = -1;
    if (afterMessageId) {
      startIndex = fresh.findIndex(
        (entry) => entry.message.id === afterMessageId,
      );
      if (startIndex === -1) {
        return [];
      }
    }

    return fresh.slice(startIndex + 1).map((entry) => entry.message);
  }

  async fetchMessage(messageId: string): Promise<ReplayMessage | null> {
    for (const entries of this.buckets.values()) {
      const found = entries.find((entry) => entry.message.id === messageId);
      if (found) {
        return found.message;
      }
    }
    return null;
  }
}

export async function createReplayCache(
  config: EnvironmentConfig["realtime"],
): Promise<ReplayCache> {
  if (config.redisUrl && !config.useMockRedis) {
    const { presenceClient } = await getRedisClients(config);
    return new RedisReplayCache(presenceClient, config);
  }

  if (config.redisUrl && config.useMockRedis) {
    const { presenceClient } = await getRedisClients(config);
    return new RedisReplayCache(presenceClient, config);
  }

  return new InMemoryReplayCache(config);
}
