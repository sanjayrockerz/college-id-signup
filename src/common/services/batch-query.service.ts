import { Injectable, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * UnreadCountBatcher
 *
 * Batches unread count queries to eliminate N+1 patterns.
 * Uses GROUP BY to fetch unread counts for multiple conversations in a single query.
 *
 * Benefits:
 * - 1 query instead of N queries for conversation list
 * - Leverages composite index on (conversationId, readAt, userId)
 * - Consistent performance regardless of conversation count
 * - Supports batching across multiple users
 *
 * Usage:
 * ```typescript
 * // Before (N+1 pattern):
 * for (const conv of conversations) {
 *   conv.unreadCount = await prisma.message.count({
 *     where: { conversationId: conv.id, readAt: null, userId: { not: currentUserId } }
 *   });
 * }
 *
 * // After (batched):
 * const unreadCounts = await batcher.getUnreadCounts(conversationIds, currentUserId);
 * conversations.forEach(conv => {
 *   conv.unreadCount = unreadCounts[conv.id] || 0;
 * });
 * ```
 */
@Injectable()
export class UnreadCountBatcher {
  private readonly logger = new Logger(UnreadCountBatcher.name);

  /**
   * Get unread message counts for multiple conversations in a single query
   *
   * @param prisma Prisma client to use
   * @param conversationIds Array of conversation IDs
   * @param userId Current user ID (to exclude their own messages)
   * @returns Map of conversationId -> unread count
   */
  async getUnreadCounts(
    prisma: PrismaClient,
    conversationIds: string[],
    userId: string,
  ): Promise<Record<string, number>> {
    if (conversationIds.length === 0) {
      return {};
    }

    try {
      // Single query with GROUP BY to get unread counts for all conversations
      const results = await prisma.$queryRaw<
        Array<{ conversationId: string; count: bigint }>
      >`
        SELECT 
          "conversationId",
          COUNT(*) as count
        FROM "Message"
        WHERE "conversationId" IN (${conversationIds.join(", ")})
          AND "readAt" IS NULL
          AND "senderId" != ${userId}
        GROUP BY "conversationId"
      `;

      // Convert to map
      const countsMap: Record<string, number> = {};

      results.forEach((row) => {
        countsMap[row.conversationId] = Number(row.count);
      });

      // Fill in 0 for conversations with no unread messages
      conversationIds.forEach((id) => {
        if (!(id in countsMap)) {
          countsMap[id] = 0;
        }
      });

      return countsMap;
    } catch (error) {
      this.logger.error(`Failed to batch unread counts: ${error}`);

      // Fallback to 0 for all conversations on error
      const fallback: Record<string, number> = {};
      conversationIds.forEach((id) => {
        fallback[id] = 0;
      });
      return fallback;
    }
  }

  /**
   * Get unread counts with additional filters (e.g., message type)
   */
  async getUnreadCountsWithFilters(
    prisma: PrismaClient,
    conversationIds: string[],
    userId: string,
    filters?: {
      messageType?: string;
      after?: Date;
    },
  ): Promise<Record<string, number>> {
    if (conversationIds.length === 0) {
      return {};
    }

    try {
      let whereClause = `
        "conversationId" IN (${conversationIds.map((id) => `'${id}'`).join(", ")})
        AND "readAt" IS NULL
        AND "senderId" != '${userId}'
      `;

      if (filters?.messageType) {
        whereClause += ` AND "type" = '${filters.messageType}'`;
      }

      if (filters?.after) {
        whereClause += ` AND "createdAt" > '${filters.after.toISOString()}'`;
      }

      const results = await prisma.$queryRaw<
        Array<{ conversationId: string; count: bigint }>
      >`
        SELECT 
          "conversationId",
          COUNT(*) as count
        FROM "Message"
        WHERE ${whereClause}
        GROUP BY "conversationId"
      `;

      const countsMap: Record<string, number> = {};

      results.forEach((row) => {
        countsMap[row.conversationId] = Number(row.count);
      });

      conversationIds.forEach((id) => {
        if (!(id in countsMap)) {
          countsMap[id] = 0;
        }
      });

      return countsMap;
    } catch (error) {
      this.logger.error(`Failed to batch unread counts with filters: ${error}`);

      const fallback: Record<string, number> = {};
      conversationIds.forEach((id) => {
        fallback[id] = 0;
      });
      return fallback;
    }
  }

  /**
   * Get last message timestamp for multiple conversations (for sorting conversation list)
   */
  async getLastMessageTimestamps(
    prisma: PrismaClient,
    conversationIds: string[],
  ): Promise<Record<string, Date | null>> {
    if (conversationIds.length === 0) {
      return {};
    }

    try {
      const results = await prisma.$queryRaw<
        Array<{ conversationId: string; lastMessageAt: Date }>
      >`
        SELECT DISTINCT ON ("conversationId")
          "conversationId",
          "createdAt" as "lastMessageAt"
        FROM "Message"
        WHERE "conversationId" IN (${conversationIds.map((id) => `'${id}'`).join(", ")})
        ORDER BY "conversationId", "createdAt" DESC
      `;

      const timestampMap: Record<string, Date | null> = {};

      results.forEach((row) => {
        timestampMap[row.conversationId] = row.lastMessageAt;
      });

      conversationIds.forEach((id) => {
        if (!(id in timestampMap)) {
          timestampMap[id] = null;
        }
      });

      return timestampMap;
    } catch (error) {
      this.logger.error(`Failed to batch last message timestamps: ${error}`);

      const fallback: Record<string, Date | null> = {};
      conversationIds.forEach((id) => {
        fallback[id] = null;
      });
      return fallback;
    }
  }

  /**
   * Get participant counts for multiple conversations
   */
  async getParticipantCounts(
    prisma: PrismaClient,
    conversationIds: string[],
  ): Promise<Record<string, number>> {
    if (conversationIds.length === 0) {
      return {};
    }

    try {
      const results = await prisma.$queryRaw<
        Array<{ conversationId: string; count: bigint }>
      >`
        SELECT 
          "conversationId",
          COUNT(*) as count
        FROM "ConversationParticipant"
        WHERE "conversationId" IN (${conversationIds.map((id) => `'${id}'`).join(", ")})
        GROUP BY "conversationId"
      `;

      const countsMap: Record<string, number> = {};

      results.forEach((row) => {
        countsMap[row.conversationId] = Number(row.count);
      });

      conversationIds.forEach((id) => {
        if (!(id in countsMap)) {
          countsMap[id] = 0;
        }
      });

      return countsMap;
    } catch (error) {
      this.logger.error(`Failed to batch participant counts: ${error}`);

      const fallback: Record<string, number> = {};
      conversationIds.forEach((id) => {
        fallback[id] = 0;
      });
      return fallback;
    }
  }

  /**
   * Batch multiple aggregates in a single call
   * Returns all metadata needed for conversation list rendering
   */
  async getConversationMetadata(
    prisma: PrismaClient,
    conversationIds: string[],
    userId: string,
  ): Promise<{
    unreadCounts: Record<string, number>;
    lastMessageTimestamps: Record<string, Date | null>;
    participantCounts: Record<string, number>;
  }> {
    if (conversationIds.length === 0) {
      return {
        unreadCounts: {},
        lastMessageTimestamps: {},
        participantCounts: {},
      };
    }

    // Execute all batches in parallel
    const [unreadCounts, lastMessageTimestamps, participantCounts] =
      await Promise.all([
        this.getUnreadCounts(prisma, conversationIds, userId),
        this.getLastMessageTimestamps(prisma, conversationIds),
        this.getParticipantCounts(prisma, conversationIds),
      ]);

    return {
      unreadCounts,
      lastMessageTimestamps,
      participantCounts,
    };
  }
}

/**
 * MessageBatcher
 *
 * Batches common message queries to reduce query count.
 */
@Injectable()
export class MessageBatcher {
  private readonly logger = new Logger(MessageBatcher.name);

  /**
   * Get read receipts for multiple messages in a single query
   *
   * @param prisma Prisma client to use
   * @param messageIds Array of message IDs
   * @returns Map of messageId -> array of read receipt timestamps
   */
  async getReadReceipts(
    prisma: PrismaClient,
    messageIds: string[],
  ): Promise<Record<string, Date[]>> {
    if (messageIds.length === 0) {
      return {};
    }

    try {
      const results = await prisma.$queryRaw<
        Array<{ messageId: string; readAt: Date }>
      >`
        SELECT "messageId", "readAt"
        FROM "MessageReadReceipt"
        WHERE "messageId" IN (${messageIds.map((id) => `'${id}'`).join(", ")})
          AND "readAt" IS NOT NULL
        ORDER BY "messageId", "readAt"
      `;

      const receiptsMap: Record<string, Date[]> = {};

      results.forEach((row) => {
        if (!receiptsMap[row.messageId]) {
          receiptsMap[row.messageId] = [];
        }
        receiptsMap[row.messageId].push(row.readAt);
      });

      messageIds.forEach((id) => {
        if (!(id in receiptsMap)) {
          receiptsMap[id] = [];
        }
      });

      return receiptsMap;
    } catch (error) {
      this.logger.error(`Failed to batch read receipts: ${error}`);

      const fallback: Record<string, Date[]> = {};
      messageIds.forEach((id) => {
        fallback[id] = [];
      });
      return fallback;
    }
  }

  /**
   * Get delivery status for multiple messages
   */
  async getDeliveryStatuses(
    prisma: PrismaClient,
    messageIds: string[],
  ): Promise<
    Record<string, { delivered: number; read: number; total: number }>
  > {
    if (messageIds.length === 0) {
      return {};
    }

    try {
      const results = await prisma.$queryRaw<
        Array<{
          messageId: string;
          delivered: bigint;
          read: bigint;
          total: bigint;
        }>
      >`
        SELECT 
          "messageId",
          COUNT(CASE WHEN "deliveredAt" IS NOT NULL THEN 1 END) as delivered,
          COUNT(CASE WHEN "readAt" IS NOT NULL THEN 1 END) as read,
          COUNT(*) as total
        FROM "MessageReadReceipt"
        WHERE "messageId" IN (${messageIds.map((id) => `'${id}'`).join(", ")})
        GROUP BY "messageId"
      `;

      const statusMap: Record<
        string,
        { delivered: number; read: number; total: number }
      > = {};

      results.forEach((row) => {
        statusMap[row.messageId] = {
          delivered: Number(row.delivered),
          read: Number(row.read),
          total: Number(row.total),
        };
      });

      messageIds.forEach((id) => {
        if (!(id in statusMap)) {
          statusMap[id] = { delivered: 0, read: 0, total: 0 };
        }
      });

      return statusMap;
    } catch (error) {
      this.logger.error(`Failed to batch delivery statuses: ${error}`);

      const fallback: Record<
        string,
        { delivered: number; read: number; total: number }
      > = {};
      messageIds.forEach((id) => {
        fallback[id] = { delivered: 0, read: 0, total: 0 };
      });
      return fallback;
    }
  }
}
