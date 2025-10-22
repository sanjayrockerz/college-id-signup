# Message History Caching Integration Example

This example shows how to integrate the CacheService with your message history endpoints.

---

## 1. Register CacheService in Your Module

```typescript
// src/common/common.module.ts
import { Module, Global } from "@nestjs/common";
import { CacheService } from "./services/cache.service";

@Global() // Make CacheService available everywhere
@Module({
  providers: [CacheService],
  exports: [CacheService], // Export so other modules can inject it
})
export class CommonModule {}
```

Import CommonModule in your AppModule:

```typescript
// src/app.module.ts
import { Module } from "@nestjs/common";
import { CommonModule } from "./common/common.module";
// ... other imports

@Module({
  imports: [
    CommonModule, // Add this
    // ... other modules
  ],
})
export class AppModule {}
```

---

## 2. Update Message Service with Caching

```typescript
// src/chat-backend/services/message.service.ts
import { Injectable, Logger } from "@nestjs/common";
import { CacheService } from "../../common/services/cache.service";
import { MessageRepository } from "../repositories/message.repository";

interface MessageHistoryParams {
  conversationId: string;
  limit: number;
  offset: number;
  userId?: string;
}

@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name);

  constructor(
    private messageRepository: MessageRepository,
    private cacheService: CacheService, // Inject cache service
  ) {}

  /**
   * Get message history with caching
   */
  async getMessageHistory(params: MessageHistoryParams) {
    const { conversationId, limit, offset, userId } = params;

    // Generate cache key
    const cacheKey = `msg:history:${conversationId}:${limit}:${offset}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get<any[]>(cacheKey);

      if (cached) {
        this.logger.debug(`Cache HIT for ${cacheKey}`);
        return {
          messages: cached,
          fromCache: true,
        };
      }

      this.logger.debug(`Cache MISS for ${cacheKey}`);

      // Query database
      const messages = await this.messageRepository.findMessageHistory({
        conversationId,
        limit,
        offset,
        userId,
      });

      // Cache for 30 seconds (recent messages) or 60 seconds (older messages)
      const ttl = offset === 0 ? 30 : 60;
      await this.cacheService.set(cacheKey, messages, ttl);

      return {
        messages,
        fromCache: false,
      };
    } catch (error) {
      this.logger.error(
        `Error in getMessageHistory: ${(error as Error).message}`,
      );

      // Fallback to database on any error
      const messages = await this.messageRepository.findMessageHistory({
        conversationId,
        limit,
        offset,
        userId,
      });

      return {
        messages,
        fromCache: false,
      };
    }
  }

  /**
   * Create message and invalidate cache
   */
  async createMessage(data: {
    conversationId: string;
    senderId: string;
    content: string;
    type: string;
  }) {
    // Create message in database
    const message = await this.messageRepository.create(data);

    // Invalidate all cached message history for this conversation
    await this.invalidateMessageCache(data.conversationId);

    this.logger.log(
      `Message created and cache invalidated for conversation ${data.conversationId}`,
    );

    return message;
  }

  /**
   * Invalidate message cache for a conversation
   */
  async invalidateMessageCache(conversationId: string): Promise<void> {
    try {
      // Delete all message history cache entries for this conversation
      const pattern = `msg:history:${conversationId}:*`;
      const deletedCount = await this.cacheService.deletePattern(pattern);

      this.logger.debug(
        `Invalidated ${deletedCount} cache entries for conversation ${conversationId}`,
      );

      // Also invalidate message count cache
      await this.cacheService.delete(`msg:count:${conversationId}`);
    } catch (error) {
      this.logger.error(
        `Error invalidating cache: ${(error as Error).message}`,
      );
      // Don't throw - cache invalidation failure shouldn't break the operation
    }
  }

  /**
   * Get message count with caching
   */
  async getMessageCount(conversationId: string): Promise<number> {
    const cacheKey = `msg:count:${conversationId}`;

    try {
      const cached = await this.cacheService.get<number>(cacheKey);

      if (cached !== null) {
        return cached;
      }

      const count = await this.messageRepository.count({ conversationId });

      // Cache for 60 seconds
      await this.cacheService.set(cacheKey, count, 60);

      return count;
    } catch (error) {
      this.logger.error(
        `Error in getMessageCount: ${(error as Error).message}`,
      );
      return await this.messageRepository.count({ conversationId });
    }
  }

  /**
   * Bulk invalidation (useful for user blocking, conversation deletion, etc.)
   */
  async invalidateUserConversations(
    userId: string,
    conversationIds: string[],
  ): Promise<void> {
    try {
      const patterns = conversationIds.map((id) => `msg:history:${id}:*`);

      for (const pattern of patterns) {
        await this.cacheService.deletePattern(pattern);
      }

      this.logger.log(
        `Invalidated cache for ${conversationIds.length} conversations`,
      );
    } catch (error) {
      this.logger.error(
        `Error in bulk cache invalidation: ${(error as Error).message}`,
      );
    }
  }
}
```

---

## 3. Update Message Controller

```typescript
// src/chat-backend/controllers/message.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { MessageService } from "../services/message.service";

@Controller("messages")
@UseGuards(JwtAuthGuard)
export class MessageController {
  constructor(private messageService: MessageService) {}

  @Get("history/:conversationId")
  async getMessageHistory(
    @Param("conversationId") conversationId: string,
    @Query("limit") limit = 50,
    @Query("offset") offset = 0,
    @CurrentUser() user: any,
  ) {
    const result = await this.messageService.getMessageHistory({
      conversationId,
      limit: Number(limit),
      offset: Number(offset),
      userId: user.id,
    });

    return {
      data: result.messages,
      meta: {
        limit: Number(limit),
        offset: Number(offset),
        count: result.messages.length,
        fromCache: result.fromCache, // Include this for debugging
      },
    };
  }

  @Post()
  async createMessage(
    @Body() body: { conversationId: string; content: string; type: string },
    @CurrentUser() user: any,
  ) {
    const message = await this.messageService.createMessage({
      ...body,
      senderId: user.id,
    });

    return {
      data: message,
      message: "Message created successfully",
    };
  }

  @Get("count/:conversationId")
  async getMessageCount(@Param("conversationId") conversationId: string) {
    const count = await this.messageService.getMessageCount(conversationId);

    return {
      data: { count },
    };
  }
}
```

---

## 4. Add Cache Metrics Endpoint

```typescript
// src/common/controllers/cache.controller.ts
import { Controller, Get, Delete, UseGuards } from "@nestjs/common";
import { CacheService } from "../services/cache.service";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { Roles } from "../../auth/decorators/roles.decorator";

@Controller("cache")
export class CacheController {
  constructor(private cacheService: CacheService) {}

  @Get("metrics")
  async getMetrics() {
    const metrics = this.cacheService.getMetrics();
    const healthy = await this.cacheService.healthCheck();

    return {
      data: {
        ...metrics,
        healthy,
        hit_ratio_percentage: (metrics.hit_ratio * 100).toFixed(2) + "%",
      },
    };
  }

  @Get("health")
  async healthCheck() {
    const healthy = await this.cacheService.healthCheck();
    const info = await this.cacheService.getInfo();

    return {
      healthy,
      redis_info: info,
    };
  }

  @Delete("flush")
  @UseGuards(JwtAuthGuard)
  @Roles("admin") // Only admins can flush cache
  async flushCache() {
    const success = await this.cacheService.flushAll();

    return {
      success,
      message: success ? "Cache flushed successfully" : "Failed to flush cache",
    };
  }

  @Delete("reset-metrics")
  @UseGuards(JwtAuthGuard)
  @Roles("admin")
  resetMetrics() {
    this.cacheService.resetMetrics();

    return {
      message: "Cache metrics reset successfully",
    };
  }
}
```

Register the controller in CommonModule:

```typescript
// src/common/common.module.ts
import { Module, Global } from "@nestjs/common";
import { CacheService } from "./services/cache.service";
import { CacheController } from "./controllers/cache.controller";

@Global()
@Module({
  controllers: [CacheController],
  providers: [CacheService],
  exports: [CacheService],
})
export class CommonModule {}
```

---

## 5. Cache Key Strategy

Use consistent cache key patterns across your application:

```typescript
// src/common/utils/cache-keys.ts

export const CacheKeys = {
  // Message history: msg:history:{conversationId}:{limit}:{offset}
  messageHistory: (conversationId: string, limit: number, offset: number) =>
    `msg:history:${conversationId}:${limit}:${offset}`,

  // Message count: msg:count:{conversationId}
  messageCount: (conversationId: string) => `msg:count:${conversationId}`,

  // Conversation metadata: conv:metadata:{conversationId}
  conversationMetadata: (conversationId: string) =>
    `conv:metadata:${conversationId}`,

  // User profile: user:profile:{userId}
  userProfile: (userId: string) => `user:profile:${userId}`,

  // Conversation list: conv:list:{userId}:{limit}:{offset}
  conversationList: (userId: string, limit: number, offset: number) =>
    `conv:list:${userId}:${limit}:${offset}`,

  // Unread count: msg:unread:{conversationId}:{userId}
  unreadCount: (conversationId: string, userId: string) =>
    `msg:unread:${conversationId}:${userId}`,
};

export const CachePatterns = {
  // Pattern to invalidate all message history for a conversation
  messageHistoryPattern: (conversationId: string) =>
    `msg:history:${conversationId}:*`,

  // Pattern to invalidate all conversation lists for a user
  conversationListPattern: (userId: string) => `conv:list:${userId}:*`,

  // Pattern to invalidate all user-related caches
  userPattern: (userId: string) => `user:*:${userId}:*`,
};

export const CacheTTL = {
  MESSAGE_HISTORY_RECENT: 30, // 30 seconds for recent messages
  MESSAGE_HISTORY_OLD: 60, // 60 seconds for older messages
  MESSAGE_COUNT: 60, // 60 seconds
  CONVERSATION_METADATA: 300, // 5 minutes (less frequently updated)
  USER_PROFILE: 600, // 10 minutes (rarely changes)
  CONVERSATION_LIST: 30, // 30 seconds (frequently updated)
  UNREAD_COUNT: 15, // 15 seconds (very dynamic)
};
```

Usage in service:

```typescript
import { CacheKeys, CacheTTL } from "../../common/utils/cache-keys";

// Instead of:
const cacheKey = `msg:history:${conversationId}:${limit}:${offset}`;
const ttl = 30;

// Use:
const cacheKey = CacheKeys.messageHistory(conversationId, limit, offset);
const ttl =
  offset === 0 ? CacheTTL.MESSAGE_HISTORY_RECENT : CacheTTL.MESSAGE_HISTORY_OLD;
```

---

## 6. Testing the Integration

### Manual Testing

```bash
# Start services
docker-compose up -d postgres redis pgbouncer

# Start your application
npm run start:dev

# Test cache metrics endpoint
curl http://localhost:3000/api/cache/metrics

# Expected response:
{
  "data": {
    "hits": 0,
    "misses": 0,
    "evictions": 0,
    "hit_ratio": 0,
    "total_requests": 0,
    "healthy": true,
    "hit_ratio_percentage": "0.00%"
  }
}
```

### Test Message History Caching

```bash
# Get message history (first request - cache miss)
curl http://localhost:3000/api/messages/history/123?limit=50&offset=0 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Response includes: "fromCache": false

# Get message history again (cache hit)
curl http://localhost:3000/api/messages/history/123?limit=50&offset=0 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Response includes: "fromCache": true

# Check cache metrics
curl http://localhost:3000/api/cache/metrics

# Expected:
{
  "data": {
    "hits": 1,
    "misses": 1,
    "hit_ratio_percentage": "50.00%"
  }
}
```

### Test Cache Invalidation

```bash
# Create a new message
curl -X POST http://localhost:3000/api/messages \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "123",
    "content": "Hello, this is a new message!",
    "type": "text"
  }'

# Get message history again (cache miss - invalidated)
curl http://localhost:3000/api/messages/history/123?limit=50&offset=0 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Response should include the new message and "fromCache": false
```

### Load Testing with Cache

```bash
# Install Apache Bench if not already installed
# macOS: brew install httpd

# Run 1000 requests with 100 concurrent connections
ab -n 1000 -c 100 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  http://localhost:3000/api/messages/history/123?limit=50&offset=0

# Check results:
# - Requests per second (should be higher with cache)
# - Time per request (should be lower with cache)

# Check cache metrics
curl http://localhost:3000/api/cache/metrics
# Expected: High hit_ratio (>80% after warmup)
```

---

## 7. Monitoring in Production

### Log Cache Performance

Add logging to track cache effectiveness:

```typescript
// In message service
async getMessageHistory(params: MessageHistoryParams) {
  const startTime = Date.now();
  const cacheKey = CacheKeys.messageHistory(params.conversationId, params.limit, params.offset);

  const cached = await this.cacheService.get<any[]>(cacheKey);
  const duration = Date.now() - startTime;

  if (cached) {
    this.logger.log(`[CACHE HIT] ${cacheKey} - ${duration}ms`);
  } else {
    this.logger.log(`[CACHE MISS] ${cacheKey} - ${duration}ms`);
  }

  // ... rest of the method
}
```

### Create Monitoring Dashboard

Example Grafana queries (if using Prometheus):

```promql
# Cache hit ratio
sum(cache_hits_total) / (sum(cache_hits_total) + sum(cache_misses_total))

# Cache response time
histogram_quantile(0.95, cache_operation_duration_seconds)

# Cache invalidations per minute
rate(cache_invalidations_total[1m])

# Most cached keys
topk(10, cache_key_access_count)
```

---

## 8. Troubleshooting

### Problem: Cache always returns null

```typescript
// Check Redis connection
const healthy = await this.cacheService.healthCheck();
console.log("Redis healthy:", healthy);

// Check if bypass switch is enabled
console.log("CACHE_BYPASS:", process.env.CACHE_BYPASS);

// Test direct Redis operation
await this.cacheService.set("test:key", "test value", 60);
const value = await this.cacheService.get("test:key");
console.log("Test value:", value);
```

### Problem: Cache not invalidating

```typescript
// Add logging to invalidation
async invalidateMessageCache(conversationId: string) {
  const pattern = `msg:history:${conversationId}:*`;
  const deletedCount = await this.cacheService.deletePattern(pattern);

  this.logger.warn(`INVALIDATED ${deletedCount} keys for pattern: ${pattern}`);

  // Verify cache is empty
  const testKey = CacheKeys.messageHistory(conversationId, 50, 0);
  const stillCached = await this.cacheService.exists(testKey);
  this.logger.warn(`Key ${testKey} still exists: ${stillCached}`);
}
```

### Problem: Out of memory

```bash
# Check Redis memory usage
docker-compose exec redis redis-cli INFO memory | grep used_memory_human

# Check eviction statistics
docker-compose exec redis redis-cli INFO stats | grep evicted_keys

# Solution: Reduce TTL values or increase maxmemory
```

---

## Summary

✅ **Integration Complete** when:

- CacheService registered in CommonModule
- Message service uses cache for read operations
- Cache invalidated on write operations
- Cache metrics endpoint available
- Tests passing with cache enabled

**Expected Performance Improvement**:

- 30-50% reduction in p95 latency
- 60-80% reduction in database queries
- Cache hit ratio >60% after warmup

**Next Steps**:

- Monitor cache metrics in production
- Tune TTL values based on observed patterns
- Extend caching to other endpoints (conversations, user profiles)
- Setup alerts for low hit ratios or high eviction rates
