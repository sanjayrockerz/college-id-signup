import { Injectable } from "@nestjs/common";
import { getPrismaClient } from "../../config/database";

export interface CreateConversationDto {
  type: "DIRECT" | "GROUP";
  title?: string;
  description?: string;
  participantIds: string[];
}

export interface SendMessageDto {
  content: string;
  messageType?: "TEXT" | "IMAGE" | "FILE" | "VOICE";
  attachments?: {
    filename: string;
    mimetype: string;
    url: string;
    size: number;
  }[];
}

export interface GetMessagesDto {
  limit?: number;
  cursor?: string;
  before?: Date;
  after?: Date;
}

@Injectable()
export class ChatRepository {
  // Use the database singleton directly
  private get db() {
    return getPrismaClient();
  }

  /**
   * Create a new conversation (direct message or group chat)
   */
  async createConversation(creatorId: string, data: CreateConversationDto) {
    const { participantIds, type, title, description } = data;

    // Ensure creator is included in participants
    const allParticipants = Array.from(new Set([creatorId, ...participantIds]));

    return await this.db.$transaction(async (tx) => {
      // Create the conversation
      const conversation = await tx.conversation.create({
        data: {
          type,
          title,
          description,
          createdById: creatorId,
        },
      });

      // Add all participants
      const conversationUsers = allParticipants.map((userId) => ({
        conversationId: conversation.id,
        userId,
        role: userId === creatorId ? "ADMIN" : "MEMBER",
        joinedAt: new Date(),
      }));

      await tx.conversationUser.createMany({
        data: conversationUsers,
      });

      // Return conversation with participants
      return await tx.conversation.findUnique({
        where: { id: conversation.id },
        include: {
          participants: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  firstName: true,
                  lastName: true,
                  profileImageUrl: true,
                  isVerified: true,
                },
              },
            },
          },
          _count: {
            select: {
              messages: true,
              participants: true,
            },
          },
        },
      });
    });
  }

  /**
   * Get conversations for a user
   */
  async getUserConversations(
    userId: string,
    limit: number = 20,
    cursor?: string,
  ) {
    const where: any = {
      participants: {
        some: {
          userId,
        },
      },
    };

    if (cursor) {
      where.updatedAt = { lt: new Date(cursor) };
    }

    const conversations = await this.db.conversation.findMany({
      where,
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true,
                profileImageUrl: true,
                isVerified: true,
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            sender: {
              select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true,
              },
            },
            attachments: true,
          },
        },
        _count: {
          select: {
            messages: true,
            participants: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: limit + 1,
    });

    const hasMore = conversations.length > limit;
    const conversationsToReturn = hasMore
      ? conversations.slice(0, -1)
      : conversations;
    const nextCursor = hasMore
      ? conversationsToReturn[
          conversationsToReturn.length - 1
        ].updatedAt.toISOString()
      : null;

    return {
      conversations: conversationsToReturn,
      hasMore,
      nextCursor,
    };
  }

  /**
   * Send a message in a conversation
   */
  async sendMessage(
    conversationId: string,
    senderId: string,
    data: SendMessageDto,
  ) {
    const { content, messageType = "TEXT", attachments = [] } = data;

    return await this.db.$transaction(async (tx) => {
      // Verify user is participant in conversation
      const participation = await tx.conversationUser.findFirst({
        where: {
          conversationId,
          userId: senderId,
        },
      });

      if (!participation) {
        throw new Error("User is not a participant in this conversation");
      }

      // Create the message
      const message = await tx.message.create({
        data: {
          content,
          messageType,
          conversationId,
          senderId,
        },
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              profileImageUrl: true,
            },
          },
        },
      });

      // Create attachments if any
      if (attachments.length > 0) {
        await tx.attachment.createMany({
          data: attachments.map((attachment) => ({
            ...attachment,
            messageId: message.id,
          })),
        });
      }

      // Update conversation's last activity
      await tx.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });

      // Get the complete message with attachments
      return await tx.message.findUnique({
        where: { id: message.id },
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              profileImageUrl: true,
            },
          },
          attachments: true,
        },
      });
    });
  }

  /**
   * Get messages from a conversation
   */
  async getMessages(
    conversationId: string,
    userId: string,
    options: GetMessagesDto = {},
  ) {
    const { limit = 50, cursor, before, after } = options;

    // Verify user is participant
    const participation = await this.db.conversationUser.findFirst({
      where: {
        conversationId,
        userId,
      },
    });

    if (!participation) {
      throw new Error("User is not a participant in this conversation");
    }

    const where: any = { conversationId };

    if (cursor) {
      where.createdAt = { lt: new Date(cursor) };
    }

    if (before) {
      where.createdAt = { ...where.createdAt, lt: before };
    }

    if (after) {
      where.createdAt = { ...where.createdAt, gt: after };
    }

    const messages = await this.db.message.findMany({
      where,
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            profileImageUrl: true,
          },
        },
        attachments: true,
        readReceipts: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
    });

    const hasMore = messages.length > limit;
    const messagesToReturn = hasMore ? messages.slice(0, -1) : messages;
    const nextCursor = hasMore
      ? messagesToReturn[messagesToReturn.length - 1].createdAt.toISOString()
      : null;

    return {
      messages: messagesToReturn,
      hasMore,
      nextCursor,
    };
  }

  /**
   * Mark messages as read
   */
  async markMessagesAsRead(
    conversationId: string,
    userId: string,
    messageIds: string[],
  ) {
    // Verify user is participant
    const participation = await this.db.conversationUser.findFirst({
      where: {
        conversationId,
        userId,
      },
    });

    if (!participation) {
      throw new Error("User is not a participant in this conversation");
    }

    // Create read receipts for messages that haven't been read yet
    const existingReadReceipts = await this.db.messageRead.findMany({
      where: {
        messageId: { in: messageIds },
        userId,
      },
      select: { messageId: true },
    });

    const alreadyReadMessageIds = existingReadReceipts.map((r) => r.messageId);
    const unreadMessageIds = messageIds.filter(
      (id) => !alreadyReadMessageIds.includes(id),
    );

    if (unreadMessageIds.length > 0) {
      await this.db.messageRead.createMany({
        data: unreadMessageIds.map((messageId) => ({
          messageId,
          userId,
          readAt: new Date(),
        })),
      });
    }

    return { markedAsRead: unreadMessageIds.length };
  }

  /**
   * Get unread message count for a user across all conversations
   */
  async getUnreadMessageCount(userId: string): Promise<number> {
    // Get all conversations user is part of
    const userConversations = await this.db.conversationUser.findMany({
      where: { userId },
      select: { conversationId: true },
    });

    const conversationIds = userConversations.map((uc) => uc.conversationId);

    if (conversationIds.length === 0) {
      return 0;
    }

    // Count messages in those conversations that user hasn't read
    const unreadCount = await this.db.message.count({
      where: {
        conversationId: { in: conversationIds },
        senderId: { not: userId }, // Don't count own messages
        readReceipts: {
          none: {
            userId,
          },
        },
      },
    });

    return unreadCount;
  }

  /**
   * Add user to conversation (for group chats)
   */
  async addUserToConversation(
    conversationId: string,
    userId: string,
    addedByUserId: string,
  ) {
    return await this.db.$transaction(async (tx) => {
      // Verify the person adding has admin role
      const adderParticipation = await tx.conversationUser.findFirst({
        where: {
          conversationId,
          userId: addedByUserId,
          role: "ADMIN",
        },
      });

      if (!adderParticipation) {
        throw new Error("Only conversation admins can add users");
      }

      // Check if user is already in conversation
      const existingParticipation = await tx.conversationUser.findFirst({
        where: {
          conversationId,
          userId,
        },
      });

      if (existingParticipation) {
        throw new Error("User is already in this conversation");
      }

      // Add user to conversation
      return await tx.conversationUser.create({
        data: {
          conversationId,
          userId,
          role: "MEMBER",
          joinedAt: new Date(),
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              profileImageUrl: true,
            },
          },
        },
      });
    });
  }

  /**
   * Find or create direct message conversation between two users
   */
  async findOrCreateDirectMessage(user1Id: string, user2Id: string) {
    // Try to find existing direct conversation between these users
    const existingConversation = await this.db.conversation.findFirst({
      where: {
        type: "DIRECT",
        participants: {
          every: {
            userId: { in: [user1Id, user2Id] },
          },
        },
        _count: {
          participants: {
            equals: 2,
          },
        },
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true,
                profileImageUrl: true,
              },
            },
          },
        },
      },
    });

    if (existingConversation) {
      return existingConversation;
    }

    // Create new direct conversation
    return await this.createConversation(user1Id, {
      type: "DIRECT",
      participantIds: [user2Id],
    });
  }
}
