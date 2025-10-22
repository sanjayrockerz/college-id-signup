/**
 * Centralized cache key management
 * Provides consistent cache key patterns and TTL values across the application
 */

export const CacheKeys = {
  /**
   * Message history cache key
   * Pattern: msg:history:{conversationId}:{limit}:{offset}
   */
  messageHistory: (
    conversationId: string,
    limit: number,
    offset: number,
  ): string => `msg:history:${conversationId}:${limit}:${offset}`,

  /**
   * Message count cache key
   * Pattern: msg:count:{conversationId}
   */
  messageCount: (conversationId: string): string =>
    `msg:count:${conversationId}`,

  /**
   * Conversation metadata cache key
   * Pattern: conv:metadata:{conversationId}
   */
  conversationMetadata: (conversationId: string): string =>
    `conv:metadata:${conversationId}`,

  /**
   * User profile cache key
   * Pattern: user:profile:{userId}
   */
  userProfile: (userId: string): string => `user:profile:${userId}`,

  /**
   * Conversation list cache key
   * Pattern: conv:list:{userId}:{limit}:{offset}
   */
  conversationList: (userId: string, limit: number, offset: number): string =>
    `conv:list:${userId}:${limit}:${offset}`,

  /**
   * Unread message count cache key
   * Pattern: msg:unread:{conversationId}:{userId}
   */
  unreadCount: (conversationId: string, userId: string): string =>
    `msg:unread:${conversationId}:${userId}`,

  /**
   * Conversation participants cache key
   * Pattern: conv:participants:{conversationId}
   */
  conversationParticipants: (conversationId: string): string =>
    `conv:participants:${conversationId}`,

  /**
   * User connections/friends cache key
   * Pattern: user:connections:{userId}
   */
  userConnections: (userId: string): string => `user:connections:${userId}`,

  /**
   * Online users cache key
   * Pattern: presence:online:{userId}
   */
  userPresence: (userId: string): string => `presence:online:${userId}`,
};

/**
 * Cache key patterns for bulk operations (invalidation, deletion)
 */
export const CachePatterns = {
  /**
   * Pattern to invalidate all message history for a conversation
   * Matches: msg:history:{conversationId}:*
   */
  messageHistoryPattern: (conversationId: string): string =>
    `msg:history:${conversationId}:*`,

  /**
   * Pattern to invalidate all conversation-related caches
   * Matches: conv:*:{conversationId}:*
   */
  conversationPattern: (conversationId: string): string =>
    `conv:*:${conversationId}:*`,

  /**
   * Pattern to invalidate all conversation lists for a user
   * Matches: conv:list:{userId}:*
   */
  conversationListPattern: (userId: string): string => `conv:list:${userId}:*`,

  /**
   * Pattern to invalidate all user-related caches
   * Matches: user:*:{userId}:*
   */
  userPattern: (userId: string): string => `user:*:${userId}:*`,

  /**
   * Pattern to invalidate all message-related caches for a conversation
   * Matches: msg:*:{conversationId}:*
   */
  messagePattern: (conversationId: string): string =>
    `msg:*:${conversationId}:*`,

  /**
   * Pattern to invalidate all unread counts for a user
   * Matches: msg:unread:*:{userId}
   */
  unreadCountPattern: (userId: string): string => `msg:unread:*:${userId}`,

  /**
   * Pattern to invalidate all presence/online status caches
   * Matches: presence:online:*
   */
  presencePattern: (): string => `presence:online:*`,
};

/**
 * Cache TTL (Time To Live) values in seconds
 * Adjust these based on your application's needs and usage patterns
 */
export const CacheTTL = {
  /** Recent message history (offset=0): 30 seconds */
  MESSAGE_HISTORY_RECENT: 30,

  /** Older message history (offset>0): 60 seconds */
  MESSAGE_HISTORY_OLD: 60,

  /** Message count: 60 seconds */
  MESSAGE_COUNT: 60,

  /** Conversation metadata: 5 minutes (less frequently updated) */
  CONVERSATION_METADATA: 300,

  /** User profile: 10 minutes (rarely changes) */
  USER_PROFILE: 600,

  /** Conversation list: 30 seconds (frequently updated) */
  CONVERSATION_LIST: 30,

  /** Unread count: 15 seconds (very dynamic) */
  UNREAD_COUNT: 15,

  /** Conversation participants: 5 minutes */
  CONVERSATION_PARTICIPANTS: 300,

  /** User connections/friends: 5 minutes */
  USER_CONNECTIONS: 300,

  /** User presence/online status: 1 minute */
  USER_PRESENCE: 60,

  /** Short-lived temporary data: 5 minutes */
  SHORT: 300,

  /** Medium-lived data: 15 minutes */
  MEDIUM: 900,

  /** Long-lived data: 1 hour */
  LONG: 3600,
};

/**
 * Helper to determine TTL based on offset
 * Use shorter TTL for recent data, longer for older data
 */
export function getMessageHistoryTTL(offset: number): number {
  return offset === 0
    ? CacheTTL.MESSAGE_HISTORY_RECENT
    : CacheTTL.MESSAGE_HISTORY_OLD;
}

/**
 * Helper to determine TTL based on data freshness requirements
 */
export function getDynamicTTL(
  updateFrequency: "high" | "medium" | "low",
): number {
  switch (updateFrequency) {
    case "high":
      return CacheTTL.SHORT;
    case "medium":
      return CacheTTL.MEDIUM;
    case "low":
      return CacheTTL.LONG;
    default:
      return CacheTTL.MEDIUM;
  }
}

/**
 * Cache invalidation helper
 * Returns list of patterns to invalidate based on operation type
 */
export function getInvalidationPatterns(
  operation:
    | "message_created"
    | "message_deleted"
    | "conversation_updated"
    | "user_updated",
  data: { conversationId?: string; userId?: string },
): string[] {
  const patterns: string[] = [];

  switch (operation) {
    case "message_created":
      if (data.conversationId) {
        patterns.push(CachePatterns.messageHistoryPattern(data.conversationId));
        patterns.push(CacheKeys.messageCount(data.conversationId));
        if (data.userId) {
          patterns.push(CachePatterns.conversationListPattern(data.userId));
          patterns.push(CachePatterns.unreadCountPattern(data.userId));
        }
      }
      break;

    case "message_deleted":
      if (data.conversationId) {
        patterns.push(CachePatterns.messageHistoryPattern(data.conversationId));
        patterns.push(CacheKeys.messageCount(data.conversationId));
      }
      break;

    case "conversation_updated":
      if (data.conversationId) {
        patterns.push(CacheKeys.conversationMetadata(data.conversationId));
        patterns.push(CacheKeys.conversationParticipants(data.conversationId));
      }
      break;

    case "user_updated":
      if (data.userId) {
        patterns.push(CacheKeys.userProfile(data.userId));
        patterns.push(CacheKeys.userConnections(data.userId));
      }
      break;
  }

  return patterns;
}

/**
 * Example usage:
 *
 * ```typescript
 * // In message service
 * const cacheKey = CacheKeys.messageHistory(conversationId, limit, offset);
 * const ttl = getMessageHistoryTTL(offset);
 * await cacheService.set(cacheKey, messages, ttl);
 *
 * // Invalidation on message creation
 * const patterns = getInvalidationPatterns('message_created', {
 *   conversationId,
 *   userId: senderId,
 * });
 *
 * for (const pattern of patterns) {
 *   await cacheService.deletePattern(pattern);
 * }
 * ```
 */
