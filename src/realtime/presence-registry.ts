import type { Redis } from "ioredis";
import type { EnvironmentConfig } from "../config/environment";
import { TelemetryMetrics } from "../observability/metrics-registry";
import { StructuredLogger } from "../common/logging/structured-logger";
import { presenceEvents } from "./presence-events";
import { getRedisClients } from "./redis-manager";

type RealtimeConfig = EnvironmentConfig["realtime"];

type PresenceSocketRecord = {
  readonly socketId: string;
  readonly instanceId: string;
  readonly connectedAt: number;
  readonly lastSeen: number;
  readonly agent?: string;
};

type PresenceMetaRecord = {
  readonly instanceId: string;
  readonly lastSeen: number;
};

interface PresenceSnapshot {
  readonly userId: string;
  readonly sockets: PresenceSocketRecord[];
  readonly lastSeen: number;
  readonly isOnline: boolean;
  readonly instanceId: string;
}

const PRESENCE_META_FIELD = "__meta__";

export class PresenceRegistry {
  private readonly redis: Redis;
  private readonly config: RealtimeConfig;

  private constructor(redis: Redis, config: RealtimeConfig) {
    this.redis = redis;
    this.config = config;
  }

  static async create(config: RealtimeConfig): Promise<PresenceRegistry> {
    const { presenceClient } = await getRedisClients(config);
    return new PresenceRegistry(presenceClient, config);
  }

  async registerConnection(
    userId: string,
    socketId: string,
    metadata: { agent?: string },
  ): Promise<void> {
    const key = this.keyFor(userId);
    const now = Date.now();
    const existed = await this.redis.exists(key);

    const record: PresenceSocketRecord = {
      socketId,
      instanceId: this.config.instanceId,
      connectedAt: now,
      lastSeen: now,
      agent: metadata.agent,
    };

    const meta: PresenceMetaRecord = {
      instanceId: this.config.instanceId,
      lastSeen: now,
    };

    const pipeline = this.redis.multi();
    pipeline.hset(key, socketId, JSON.stringify(record));
    pipeline.hset(key, PRESENCE_META_FIELD, JSON.stringify(meta));
    pipeline.pexpire(key, this.config.presenceTtlMs);

    try {
      await pipeline.exec();
      TelemetryMetrics.incrementPresenceWrite("connect");

      if (existed === 0) {
        presenceEvents.emit("presence.online", {
          userId,
          status: "online",
          instanceId: this.config.instanceId,
          socketId,
          timestamp: new Date(now).toISOString(),
        });
        StructuredLogger.info("presence.online", {
          userId,
          status: "success",
          data: {
            socketId,
          },
        });
      }
    } catch (error) {
      StructuredLogger.error("presence.connect", {
        userId,
        status: "failed",
        data: {
          socketId,
        },
        error: {
          code: "redis.register_failure",
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
      });
      throw error;
    }
  }

  async extendHeartbeat(userId: string, socketId: string): Promise<void> {
    const key = this.keyFor(userId);
    const now = Date.now();
    const pipeline = this.redis.multi();
    pipeline.pexpire(key, this.config.presenceTtlMs);
    pipeline.hget(key, socketId);
    pipeline.hset(
      key,
      PRESENCE_META_FIELD,
      JSON.stringify({ instanceId: this.config.instanceId, lastSeen: now }),
    );

    try {
      const [, socketPayload] = (await pipeline.exec()) ?? [];
      if (
        Array.isArray(socketPayload) &&
        socketPayload[0] === null &&
        socketPayload[1]
      ) {
        const current = this.parseSocketRecord(socketPayload[1] as string);
        if (current) {
          const updated = {
            ...current,
            lastSeen: now,
          } satisfies PresenceSocketRecord;
          await this.redis.hset(key, socketId, JSON.stringify(updated));
        }
      }
      TelemetryMetrics.incrementHeartbeatExtend("success");
    } catch (error) {
      TelemetryMetrics.incrementHeartbeatExtend("error");
      StructuredLogger.warn("presence.heartbeat", {
        userId,
        status: "error",
        data: {
          socketId,
        },
        error: {
          code: "redis.heartbeat_failure",
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
      });
    }
  }

  async unregister(userId: string, socketId: string): Promise<void> {
    const key = this.keyFor(userId);
    const pipeline = this.redis.multi();
    pipeline.hdel(key, socketId);
    pipeline.hlen(key);
    try {
      const results = await pipeline.exec();

      TelemetryMetrics.incrementPresenceWrite("disconnect");

      const remaining = Number(results?.[1]?.[1] ?? 0);
      if (remaining <= 1) {
        await this.redis.del(key);
        presenceEvents.emit("presence.offline", {
          userId,
          status: "offline",
          instanceId: this.config.instanceId,
          socketId,
          timestamp: new Date().toISOString(),
        });
        StructuredLogger.info("presence.offline", {
          userId,
          status: "success",
          data: {
            socketId,
          },
        });
      }
    } catch (error) {
      StructuredLogger.warn("presence.disconnect", {
        userId,
        status: "error",
        data: {
          socketId,
        },
        error: {
          code: "redis.disconnect_failure",
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
      });
    }
  }

  async whoIs(userId: string): Promise<PresenceSnapshot | null> {
    const key = this.keyFor(userId);
    const entries = await this.redis.hgetall(key);
    if (Object.keys(entries).length === 0) {
      return null;
    }

    const sockets: PresenceSocketRecord[] = [];
    let meta: PresenceMetaRecord | undefined;

    for (const [field, payload] of Object.entries(entries)) {
      if (field === PRESENCE_META_FIELD) {
        meta = this.parseMetaRecord(payload);
        continue;
      }
      const record = this.parseSocketRecord(payload);
      if (record) {
        sockets.push(record);
      }
    }

    if (!meta) {
      return null;
    }

    return {
      userId,
      sockets,
      lastSeen: meta.lastSeen,
      instanceId: meta.instanceId,
      isOnline: sockets.length > 0,
    };
  }

  async socketsOf(userId: string): Promise<string[]> {
    const key = this.keyFor(userId);
    const fields = await this.redis.hkeys(key);
    return fields.filter((field) => field !== PRESENCE_META_FIELD);
  }

  async isOnline(userId: string): Promise<boolean> {
    const key = this.keyFor(userId);
    const socketCount = await this.redis.hlen(key);
    return Math.max(socketCount - 1, 0) > 0;
  }

  private keyFor(userId: string): string {
    return `${this.config.redisKeyPrefix}:presence:${userId}`;
  }

  private parseSocketRecord(payload: string): PresenceSocketRecord | null {
    try {
      const parsed = JSON.parse(payload);
      if (!parsed || typeof parsed.socketId !== "string") {
        return null;
      }
      return parsed as PresenceSocketRecord;
    } catch (error) {
      void error;
      return null;
    }
  }

  private parseMetaRecord(payload: string): PresenceMetaRecord | undefined {
    try {
      const parsed = JSON.parse(payload);
      if (!parsed || typeof parsed.instanceId !== "string") {
        return undefined;
      }
      return parsed as PresenceMetaRecord;
    } catch (error) {
      void error;
      return undefined;
    }
  }
}
