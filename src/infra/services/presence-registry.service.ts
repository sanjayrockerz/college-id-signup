import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";

interface PresenceSocketMetadata {
  readonly agent?: string;
  readonly instanceId?: string;
}

interface PresenceRecord {
  readonly userId: string;
  readonly socketId: string;
  readonly connectedAt: number;
  readonly lastSeenAt: number;
  readonly metadata?: PresenceSocketMetadata;
}

interface OnlineRecipientRecord {
  readonly userId: string;
  readonly socketIds: string[];
}

const DEFAULT_PRESENCE_TTL_MS = 60_000; // 60 seconds default TTL
const DEFAULT_KEY_PREFIX = "user";

@Injectable()
export class PresenceRegistryService implements OnModuleDestroy {
  private readonly logger = new Logger(PresenceRegistryService.name);
  private readonly redis: Redis;
  private readonly ttlMs: number;
  private readonly keyPrefix: string;

  constructor() {
    const host = process.env.REDIS_HOST || "localhost";
    const port = parseInt(process.env.REDIS_PORT || "6379", 10);
    const password = process.env.REDIS_PASSWORD;
    const db = parseInt(
      process.env.REDIS_PRESENCE_DB || process.env.REDIS_STREAM_DB || "1",
      10,
    );

    this.redis = new Redis({
      host,
      port,
      password,
      db,
      retryStrategy: (attempt) => Math.min(attempt * 50, 2000),
      maxRetriesPerRequest: 5,
    });

    this.ttlMs = parseInt(
      process.env.PRESENCE_TTL_MS || `${DEFAULT_PRESENCE_TTL_MS}`,
      10,
    );
    this.keyPrefix = process.env.PRESENCE_KEY_PREFIX || DEFAULT_KEY_PREFIX;
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }

  /**
   * Registers a socket as online for the given user.
   */
  async registerSocket(
    userId: string,
    socketId: string,
    metadata: PresenceSocketMetadata = {},
  ): Promise<void> {
    const now = Date.now();
    const key = this.buildKey(userId);
    const socketKey = this.buildSocketKey(userId, socketId);

    const record: PresenceRecord = {
      userId,
      socketId,
      connectedAt: now,
      lastSeenAt: now,
      metadata,
    };

    const pipeline = this.redis.pipeline();
    pipeline.sadd(key, socketId);
    pipeline.hset(socketKey, "userId", userId);
    pipeline.hset(socketKey, "socketId", socketId);
    pipeline.hset(socketKey, "connectedAt", record.connectedAt.toString());
    pipeline.hset(socketKey, "lastSeenAt", record.lastSeenAt.toString());
    pipeline.hset(socketKey, "metadata", JSON.stringify(metadata ?? {}));
    pipeline.pexpire(key, this.ttlMs);
    pipeline.pexpire(socketKey, this.ttlMs);

    try {
      await pipeline.exec();
    } catch (error) {
      this.logger.warn(
        `Presence registry register pipeline failed for user ${userId}`,
        error instanceof Error ? error : undefined,
      );
      throw error;
    }
  }

  /**
   * Refreshes heartbeat for a socket to keep TTL alive.
   */
  async heartbeat(userId: string, socketId: string): Promise<void> {
    const key = this.buildKey(userId);
    const socketKey = this.buildSocketKey(userId, socketId);
    const now = Date.now();

    const pipeline = this.redis.pipeline();
    pipeline.pexpire(key, this.ttlMs);
    pipeline.pexpire(socketKey, this.ttlMs);
    pipeline.hset(socketKey, "lastSeenAt", now.toString());

    try {
      await pipeline.exec();
    } catch (error) {
      this.logger.warn(
        `Presence registry heartbeat pipeline failed for user ${userId}`,
        error instanceof Error ? error : undefined,
      );
      throw error;
    }
  }

  /**
   * Removes a socket registration when it disconnects.
   */
  async unregisterSocket(userId: string, socketId: string): Promise<void> {
    const key = this.buildKey(userId);
    const socketKey = this.buildSocketKey(userId, socketId);

    const pipeline = this.redis.pipeline();
    pipeline.srem(key, socketId);
    pipeline.del(socketKey);
    pipeline.scard(key);

    try {
      const responses = await pipeline.exec();
      const remaining = Number(responses?.[2]?.[1] ?? 0);
      if (remaining === 0) {
        await this.redis.del(key);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to unregister socket ${socketId} for user ${userId}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Returns socket IDs for the requested users.
   */
  async getOnlineRecipients(
    userIds: string[],
  ): Promise<OnlineRecipientRecord[]> {
    if (userIds.length === 0) {
      return [];
    }

    const pipeline = this.redis.pipeline();
    userIds.forEach((userId) => pipeline.smembers(this.buildKey(userId)));

    const results = await pipeline.exec();
    if (!results) {
      return [];
    }

    const online: OnlineRecipientRecord[] = [];
    results.forEach((result, index) => {
      const [, socketIds] = result ?? [];
      if (Array.isArray(socketIds) && socketIds.length > 0) {
        online.push({
          userId: userIds[index],
          socketIds: socketIds.filter(
            (id) => typeof id === "string" && id.length > 0,
          ),
        });
      }
    });

    return online;
  }

  private buildKey(userId: string): string {
    return `${this.keyPrefix}:${userId}:online`;
  }

  private buildSocketKey(userId: string, socketId: string): string {
    return `${this.keyPrefix}:${userId}:socket:${socketId}`;
  }
}
