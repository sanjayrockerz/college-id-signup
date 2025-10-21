import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import {
  ChatRepository,
  CreateConversationDto,
  SendMessageDto,
  GetMessagesDto,
} from "../repositories/chat.repository";

// Utility function for safe error handling
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export interface ChatServiceInterface {
  createConversation(userId: string, data: CreateConversationDto): Promise<any>;
  getUserConversations(
    userId: string,
    limit?: number,
    cursor?: string,
  ): Promise<any>;
  sendMessage(
    conversationId: string,
    userId: string,
    data: SendMessageDto,
  ): Promise<any>;
  getMessages(
    conversationId: string,
    userId: string,
    options?: GetMessagesDto,
  ): Promise<any>;
  markMessagesAsRead(
    conversationId: string,
    userId: string,
    messageIds: string[],
  ): Promise<any>;
  getUnreadCount(userId: string): Promise<number>;
  findOrCreateDirectMessage(user1Id: string, user2Id: string): Promise<any>;
}

@Injectable()
export class ChatService implements ChatServiceInterface {
  constructor(private readonly chatRepository: ChatRepository) {}

  /**
   * Create a new conversation (direct or group)
   */
  async createConversation(userId: string, data: CreateConversationDto) {
    try {
      // Validate input
      if (data.type === "DIRECT" && data.participantIds.length !== 1) {
        throw new BadRequestException(
          "Direct conversations must have exactly one other participant",
        );
      }

      if (data.type === "GROUP" && data.participantIds.length < 1) {
        throw new BadRequestException(
          "Group conversations must have at least one other participant",
        );
      }

      if (data.type === "GROUP" && !data.title) {
        throw new BadRequestException("Group conversations must have a title");
      }

      // For direct messages, check if conversation already exists
      if (data.type === "DIRECT") {
        const existingConversation =
          await this.chatRepository.findOrCreateDirectMessage(
            userId,
            data.participantIds[0],
          );
        return {
          success: true,
          conversation: existingConversation,
          message: "Direct conversation ready",
        };
      }

      // Create new conversation
      const conversation = await this.chatRepository.createConversation(
        userId,
        data,
      );

      return {
        success: true,
        conversation,
        message: "Conversation created successfully",
      };
    } catch (error) {
      throw new BadRequestException(
        `Failed to create conversation: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * Get user's conversations with pagination
   */
  async getUserConversations(
    userId: string,
    limit: number = 20,
    cursor?: string,
  ) {
    try {
      const result = await this.chatRepository.getUserConversations(
        userId,
        limit,
        cursor,
      );

      // Enhance conversations with additional metadata
      const enhancedConversations = result.conversations.map((conversation) => {
        const lastMessage = conversation.messages[0] || null;
        const otherParticipants = conversation.participants.filter(
          (p) => p.userId !== userId,
        );

        return {
          ...conversation,
          lastMessage,
          otherParticipants: otherParticipants.map((p) => p.user),
          unreadCount: 0, // Will be calculated separately for performance
          isOnline: false, // Will be enhanced with real-time status
        };
      });

      return {
        success: true,
        data: {
          conversations: enhancedConversations,
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
        },
      };
    } catch (error) {
      throw new BadRequestException(
        `Failed to get conversations: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * Send a message in a conversation
   */
  async sendMessage(
    conversationId: string,
    userId: string,
    data: SendMessageDto,
  ) {
    try {
      // Validate message content
      if (
        !data.content?.trim() &&
        (!data.attachments || data.attachments.length === 0)
      ) {
        throw new BadRequestException(
          "Message must have content or attachments",
        );
      }

      // Validate attachments if present
      if (data.attachments) {
        for (const attachment of data.attachments) {
          if (!attachment.filename || !attachment.url || !attachment.mimetype) {
            throw new BadRequestException("Invalid attachment data");
          }
        }
      }

      const message = await this.chatRepository.sendMessage(
        conversationId,
        userId,
        data,
      );

      return {
        success: true,
        message,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      if (errorMessage.includes("not a participant")) {
        throw new ForbiddenException(
          "You are not a participant in this conversation",
        );
      }
      throw new BadRequestException(`Failed to send message: ${errorMessage}`);
    }
  }

  /**
   * Get messages from a conversation with pagination
   */
  async getMessages(
    conversationId: string,
    userId: string,
    options: GetMessagesDto = {},
  ) {
    try {
      const result = await this.chatRepository.getMessages(
        conversationId,
        userId,
        options,
      );

      return {
        success: true,
        data: {
          messages: result.messages,
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
        },
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      if (errorMessage.includes("not a participant")) {
        throw new ForbiddenException(
          "You are not a participant in this conversation",
        );
      }
      throw new BadRequestException(`Failed to get messages: ${errorMessage}`);
    }
  }

  /**
   * Mark messages as read
   */
  async markMessagesAsRead(
    conversationId: string,
    userId: string,
    messageIds: string[],
  ) {
    try {
      if (!messageIds || messageIds.length === 0) {
        throw new BadRequestException("No message IDs provided");
      }

      const result = await this.chatRepository.markMessagesAsRead(
        conversationId,
        userId,
        messageIds,
      );

      return {
        success: true,
        markedAsRead: result.markedAsRead,
        message: `Marked ${result.markedAsRead} messages as read`,
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      if (errorMessage.includes("not a participant")) {
        throw new ForbiddenException(
          "You are not a participant in this conversation",
        );
      }
      throw new BadRequestException(
        `Failed to mark messages as read: ${errorMessage}`,
      );
    }
  }

  /**
   * Get total unread message count for user
   */
  async getUnreadCount(userId: string): Promise<number> {
    try {
      return await this.chatRepository.getUnreadMessageCount(userId);
    } catch (error) {
      throw new BadRequestException(
        `Failed to get unread count: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * Find or create direct message conversation
   */
  async findOrCreateDirectMessage(user1Id: string, user2Id: string) {
    try {
      if (user1Id === user2Id) {
        throw new BadRequestException(
          "Cannot create conversation with yourself",
        );
      }

      const conversation = await this.chatRepository.findOrCreateDirectMessage(
        user1Id,
        user2Id,
      );

      return {
        success: true,
        conversation,
        message: "Direct message conversation ready",
      };
    } catch (error) {
      throw new BadRequestException(
        `Failed to create direct message: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * Add user to group conversation
   */
  async addUserToConversation(
    conversationId: string,
    userId: string,
    addedByUserId: string,
  ) {
    try {
      const result = await this.chatRepository.addUserToConversation(
        conversationId,
        userId,
        addedByUserId,
      );

      return {
        success: true,
        participant: result,
        message: "User added to conversation successfully",
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      if (errorMessage.includes("Only conversation admins")) {
        throw new ForbiddenException("Only conversation admins can add users");
      }
      if (errorMessage.includes("already in this conversation")) {
        throw new BadRequestException("User is already in this conversation");
      }
      throw new BadRequestException(
        `Failed to add user to conversation: ${errorMessage}`,
      );
    }
  }

  /**
   * Get conversation details
   */
  async getConversationDetails(conversationId: string, userId: string) {
    try {
      // This would be implemented in the repository
      // For now, we'll get it through getUserConversations and filter
      const result = await this.chatRepository.getUserConversations(
        userId,
        100,
      );
      const conversation = result.conversations.find(
        (c) => c.id === conversationId,
      );

      if (!conversation) {
        throw new NotFoundException(
          "Conversation not found or you are not a participant",
        );
      }

      return {
        success: true,
        conversation,
      };
    } catch (error) {
      throw new BadRequestException(
        `Failed to get conversation details: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * Search messages in a conversation
   */
  async searchMessages(
    conversationId: string,
    userId: string,
    query: string,
    limit: number = 20,
  ) {
    try {
      // This would be implemented with full-text search capabilities
      // For now, return a placeholder implementation
      return {
        success: true,
        data: {
          messages: [],
          total: 0,
          query,
          conversationId,
          userId,
          limit,
        },
        message: "Message search feature coming soon",
      };
    } catch (error) {
      throw new BadRequestException(
        `Failed to search messages: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * Get conversation statistics
   */
  async getConversationStats(conversationId: string, userId: string) {
    try {
      // This would provide analytics like message counts, active users, etc.
      return {
        success: true,
        stats: {
          totalMessages: 0,
          totalParticipants: 0,
          messagesThisWeek: 0,
          mostActiveUser: null,
        },
        message: "Conversation statistics feature coming soon",
        context: {
          conversationId,
          userId,
        },
      };
    } catch (error) {
      throw new BadRequestException(
        `Failed to get conversation stats: ${getErrorMessage(error)}`,
      );
    }
  }
}
