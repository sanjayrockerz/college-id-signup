import { Injectable, Logger } from "@nestjs/common";
import Redis from "ioredis";
import { TelemetryMetrics } from "../../observability/metrics-registry";

export interface CacheMetrics {
  hits: number;
  misses: number;
  evictions: number;
  hit_ratio: number;
  total_requests: number;
}

export interface CacheConfig {
  enabled: boolean;
  ttl: number;
  keyPrefix: string;
}

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private redis: Redis | null = null;
  private metrics: CacheMetrics = {
    hits: 0,
    misses: 0,
    evictions: 0,
    hit_ratio: 0,
    total_requests: 0,
  };

  private readonly enabled: boolean;
  private readonly bypassSwitch: boolean;

  constructor() {
    this.enabled = process.env.ENABLE_REDIS_CACHE !== "false";
    this.bypassSwitch = process.env.CACHE_BYPASS === "true";

    if (this.enabled && !this.bypassSwitch) {
      this.initializeRedis();
    } else {
      this.logger.warn("Redis cache is disabled or bypassed");
    }
  }

  private initializeRedis(): void {
    try {
      const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

      this.redis = new Redis(redisUrl, {
        retryStrategy: (times: number) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: false,
      });

      this.redis.on("connect", () => {
        this.logger.log("Redis connected successfully");
      });

      this.redis.on("error", (err: Error) => {
        this.logger.error(`Redis connection error: ${err.message}`);
      });

      this.redis.on("close", () => {
        this.logger.warn("Redis connection closed");
      });

      this.redis.on("reconnecting", () => {
        this.logger.log("Redis reconnecting...");
      });
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to initialize Redis: ${err.message}`);
      this.redis = null;
    }
  }

  /**
   * Get value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.redis || this.bypassSwitch) {
      return null;
    }

    const startTime = Date.now();
    const entity = this.extractEntityFromKey(key);

    try {
      this.metrics.total_requests++;
      const value = await this.redis.get(key);

      const latency = Date.now() - startTime;

      if (value === null) {
        this.metrics.misses++;
        this.updateHitRatio();

        // Emit metrics
        TelemetryMetrics.incrementCacheOperation("get", "miss", entity);
        TelemetryMetrics.observeCacheLatency("get", entity, latency);
        TelemetryMetrics.setCacheHitRatio(entity, this.metrics.hit_ratio);

        return null;
      }

      this.metrics.hits++;
      this.updateHitRatio();

      // Emit metrics
      TelemetryMetrics.incrementCacheOperation("get", "hit", entity);
      TelemetryMetrics.observeCacheLatency("get", entity, latency);
      TelemetryMetrics.setCacheHitRatio(entity, this.metrics.hit_ratio);

      try {
        return JSON.parse(value) as T;
      } catch {
        return value as T;
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Cache GET error for key ${key}: ${err.message}`);

      TelemetryMetrics.incrementCacheOperation("get", "error", entity);
      TelemetryMetrics.observeCacheLatency(
        "get",
        entity,
        Date.now() - startTime,
      );

      return null;
    }
  }

  /**
   * Set value in cache with TTL
   */
  async set(key: string, value: any, ttlSeconds?: number): Promise<boolean> {
    if (!this.redis || this.bypassSwitch) {
      return false;
    }

    const startTime = Date.now();
    const entity = this.extractEntityFromKey(key);

    try {
      const serialized = JSON.stringify(value);

      if (ttlSeconds) {
        await this.redis.setex(key, ttlSeconds, serialized);
      } else {
        await this.redis.set(key, serialized);
      }

      const latency = Date.now() - startTime;

      // Emit metrics
      TelemetryMetrics.incrementCacheOperation("set", "hit", entity);
      TelemetryMetrics.observeCacheLatency("set", entity, latency);

      return true;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Cache SET error for key ${key}: ${err.message}`);

      TelemetryMetrics.incrementCacheOperation("set", "error", entity);
      TelemetryMetrics.observeCacheLatency(
        "set",
        entity,
        Date.now() - startTime,
      );

      return false;
    }
  }

  /**
   * Delete key(s) from cache
   */
  async delete(key: string | string[]): Promise<number> {
    if (!this.redis || this.bypassSwitch) {
      return 0;
    }

    const startTime = Date.now();
    const keys = Array.isArray(key) ? key : [key];
    const entity = this.extractEntityFromKey(keys[0]);

    try {
      const deletedCount = await this.redis.del(...keys);

      const latency = Date.now() - startTime;

      // Emit metrics
      TelemetryMetrics.incrementCacheOperation("delete", "hit", entity);
      TelemetryMetrics.observeCacheLatency("delete", entity, latency);
      TelemetryMetrics.incrementCacheEviction(entity, "invalidation");

      return deletedCount;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Cache DELETE error: ${err.message}`);

      TelemetryMetrics.incrementCacheOperation("delete", "error", entity);

      return 0;
    }
  }

  /**
   * Delete keys matching pattern (for invalidation)
   */
  async deletePattern(pattern: string): Promise<number> {
    if (!this.redis || this.bypassSwitch) {
      return 0;
    }

    const startTime = Date.now();
    const entity = this.extractEntityFromKey(pattern);

    try {
      const keys = await this.redis.keys(pattern);

      if (keys.length === 0) {
        return 0;
      }

      const deletedCount = await this.redis.del(...keys);

      const latency = Date.now() - startTime;

      // Emit metrics
      TelemetryMetrics.incrementCacheOperation("invalidate", "hit", entity);
      TelemetryMetrics.observeCacheLatency("invalidate", entity, latency);
      TelemetryMetrics.incrementCacheEviction(entity, "invalidation");

      return deletedCount;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Cache DELETE PATTERN error: ${err.message}`);

      TelemetryMetrics.incrementCacheOperation("invalidate", "error", entity);

      return 0;
    }
  }

  /**
   * Extract entity type from cache key for metrics labeling
   */
  private extractEntityFromKey(key: string): string {
    // Extract entity from keys like "msg:history:conversationId:limit:offset"
    if (key.startsWith("msg:")) return "message";
    if (key.startsWith("conv:")) return "conversation";
    if (key.startsWith("user:")) return "user";
    return "other";
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    if (!this.redis || this.bypassSwitch) {
      return false;
    }

    try {
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Cache EXISTS error: ${err.message}`);
      return false;
    }
  }

  /**
   * Get remaining TTL for key
   */
  async ttl(key: string): Promise<number> {
    if (!this.redis || this.bypassSwitch) {
      return -2;
    }

    try {
      return await this.redis.ttl(key);
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Cache TTL error: ${err.message}`);
      return -2;
    }
  }

  /**
   * Increment counter (for metrics)
   */
  async increment(key: string, delta: number = 1): Promise<number> {
    if (!this.redis || this.bypassSwitch) {
      return 0;
    }

    try {
      return await this.redis.incrby(key, delta);
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Cache INCREMENT error: ${err.message}`);
      return 0;
    }
  }

  /**
   * Get multiple keys at once (pipeline)
   */
  async getMulti<T>(keys: string[]): Promise<Array<T | null>> {
    if (!this.redis || this.bypassSwitch || keys.length === 0) {
      return keys.map(() => null);
    }

    try {
      const values = await this.redis.mget(...keys);

      return values.map((value) => {
        if (value) {
          this.recordHit();
          return JSON.parse(value) as T;
        } else {
          this.recordMiss();
          return null;
        }
      });
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Cache GETMULTI error: ${err.message}`);
      return keys.map(() => null);
    }
  }

  /**
   * Set multiple keys at once (pipeline)
   */
  async setMulti(
    entries: Array<{ key: string; value: any; ttl?: number }>,
  ): Promise<boolean> {
    if (!this.redis || this.bypassSwitch || entries.length === 0) {
      return false;
    }

    try {
      const pipeline = this.redis.pipeline();

      for (const entry of entries) {
        const serialized = JSON.stringify(entry.value);

        if (entry.ttl) {
          pipeline.setex(entry.key, entry.ttl, serialized);
        } else {
          pipeline.set(entry.key, serialized);
        }
      }

      await pipeline.exec();
      return true;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Cache SETMULTI error: ${err.message}`);
      return false;
    }
  }

  /**
   * Flush all cache (use with caution)
   */
  async flushAll(): Promise<boolean> {
    if (!this.redis) {
      return false;
    }

    try {
      await this.redis.flushall();
      this.logger.warn("Cache flushed (FLUSHALL executed)");
      return true;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Cache FLUSHALL error: ${err.message}`);
      return false;
    }
  }

  /**
   * Get cache metrics
   */
  getMetrics(): CacheMetrics {
    const total = this.metrics.hits + this.metrics.misses;
    const hitRatio = total > 0 ? this.metrics.hits / total : 0;

    return {
      ...this.metrics,
      hit_ratio: hitRatio,
      total_requests: total,
    };
  }

  /**
   * Reset metrics (for testing)
   */
  resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      evictions: 0,
      hit_ratio: 0,
      total_requests: 0,
    };
  }

  /**
   * Get Redis info (for monitoring)
   */
  async getInfo(): Promise<any> {
    if (!this.redis) {
      return null;
    }

    try {
      const info = await this.redis.info();
      return this.parseRedisInfo(info);
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to get Redis info: ${err.message}`);
      return null;
    }
  }

  /**
   * Check Redis health
   */
  async healthCheck(): Promise<boolean> {
    if (!this.redis) {
      return false;
    }

    try {
      const response = await this.redis.ping();
      return response === "PONG";
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Redis health check failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Graceful shutdown
   */
  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.logger.log("Redis connection closed gracefully");
    }
  }

  // Private helper methods

  private recordHit(): void {
    this.metrics.hits++;
  }

  private recordMiss(): void {
    this.metrics.misses++;
  }

  private updateHitRatio(): void {
    const total = this.metrics.hits + this.metrics.misses;
    this.metrics.hit_ratio = total > 0 ? this.metrics.hits / total : 0;
    this.metrics.total_requests = total;
  }

  private parseRedisInfo(info: string): any {
    const lines = info.split("\r\n");
    const result: any = {};

    for (const line of lines) {
      if (line.startsWith("#") || line.trim() === "") {
        continue;
      }

      const [key, value] = line.split(":");
      if (key && value) {
        result[key.trim()] = value.trim();
      }
    }

    return result;
  }
}
