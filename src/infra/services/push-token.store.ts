import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";

export interface DeviceTokenRecord {
  readonly token: string;
  readonly platform: "fcm" | "apns";
}

@Injectable()
export class PushTokenStore implements OnModuleDestroy {
  private readonly logger = new Logger(PushTokenStore.name);
  private readonly redis: Redis;
  private readonly keyPrefix: string;

  constructor() {
    const host = process.env.REDIS_HOST || "localhost";
    const port = parseInt(process.env.REDIS_PORT || "6379", 10);
    const password = process.env.REDIS_PASSWORD;
    const db = parseInt(
      process.env.REDIS_PUSH_DB || process.env.REDIS_STREAM_DB || "1",
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

    this.keyPrefix = process.env.PUSH_TOKEN_KEY_PREFIX || "device_tokens";
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch (error) {
      this.logger.warn(
        "Failed to close push token redis connection",
        error instanceof Error ? error : undefined,
      );
    }
  }

  private buildKey(userId: string): string {
    return `${this.keyPrefix}:${userId}`;
  }

  async addToken(userId: string, record: DeviceTokenRecord): Promise<void> {
    const key = this.buildKey(userId);
    const payload = JSON.stringify(record);
    await this.redis.sadd(key, payload);
  }

  async removeToken(userId: string, token: string): Promise<void> {
    const key = this.buildKey(userId);
    const entries = await this.redis.smembers(key);
    const matches = entries.filter((entry) => {
      try {
        const parsed = JSON.parse(entry) as DeviceTokenRecord;
        return parsed.token === token;
      } catch (error) {
        void error;
        return false;
      }
    });

    if (matches.length === 0) {
      return;
    }

    await this.redis.srem(key, ...matches);
  }

  async getTokens(userId: string): Promise<DeviceTokenRecord[]> {
    const key = this.buildKey(userId);
    const entries = await this.redis.smembers(key);

    const tokens: DeviceTokenRecord[] = [];
    for (const entry of entries) {
      try {
        const parsed = JSON.parse(entry) as DeviceTokenRecord;
        if (parsed && typeof parsed.token === "string") {
          tokens.push(parsed);
        }
      } catch (error) {
        this.logger.warn(
          "Failed to parse device token record",
          error instanceof Error ? error : undefined,
        );
      }
    }

    return tokens;
  }
}
