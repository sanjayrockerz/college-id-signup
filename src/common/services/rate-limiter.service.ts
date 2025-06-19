import { Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';

@Injectable()
export class RateLimiterService {
  private redisClient: Redis.Redis;

  constructor() {
    this.redisClient = new Redis();
  }

  async isRateLimited(userId: string): Promise<boolean> {
    const key = `rate-limit:${userId}`;
    const currentCount = await this.redisClient.incr(key);

    if (currentCount === 1) {
      await this.redisClient.expire(key, 3600); // 1 hour
    }

    return currentCount > 3; // Limit to 3 uploads per hour
  }
}

