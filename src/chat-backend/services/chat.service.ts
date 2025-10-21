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

const isMockPrismaMode = () => process.env.PRISMA_CLIENT_MODE === "mock";

interface MockConversationRecord {
  id: string;
  type: "DIRECT" | "GROUP";
  title?: string;
  description?: string;
  participantIds: string[];
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

interface MockMessageRecord {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  messageType: "TEXT" | "IMAGE" | "FILE" | "VOICE";
  createdAt: Date;
}

const mockChatStore = {
  conversations: new Map<string, MockConversationRecord>(),
  messages: new Map<string, MockMessageRecord[]>(),
};

let mockIdCounter = 0;
const nextMockId = (prefix: string) => `${prefix}-${++mockIdCounter}`;

const serializeMockConversation = (conversation: MockConversationRecord) => ({
  id: conversation.id,
  type: conversation.type,
  title: conversation.title,
  description: conversation.description,
  participants: conversation.participantIds.map((userId) => ({
    userId,
  })),
  participantIds: conversation.participantIds,
  createdById: conversation.createdById,
  createdAt: conversation.createdAt,
  updatedAt: conversation.updatedAt,
});

const serializeMockMessage = (message: MockMessageRecord) => ({
  id: message.id,
  content: message.content,
  messageType: message.messageType,
  senderId: message.senderId,
  createdAt: message.createdAt,
});

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

  private createConversationMock(
    userId: string,
    data: CreateConversationDto,
  ) {
    const participants = Array.from(new Set([userId, ...data.participantIds]));

    if (data.type === "DIRECT") {
      const existing = [...mockChatStore.conversations.values()].find(
        (conversation) =>
          conversation.type === "DIRECT" &&
          participants.length === conversation.participantIds.length &&
          participants.every((id) =>
            conversation.participantIds.includes(id),
          ),
      );

      if (existing) {
        return {
          success: true,
          conversation: serializeMockConversation(existing),
          message: "Direct conversation ready",
        };
      }
    }

    const now = new Date();
    const conversation: MockConversationRecord = {
      id: nextMockId("mock-conv"),
      type: data.type,
      title: data.title,
      description: data.description,
      participantIds: participants,
      createdById: userId,
      createdAt: now,
      updatedAt: now,
    };

    mockChatStore.conversations.set(conversation.id, conversation);
    mockChatStore.messages.set(conversation.id, []);

    return {
      success: true,
      conversation: serializeMockConversation(conversation),
      message:
        data.type === "DIRECT"
          ? "Direct conversation ready"
          : "Conversation created successfully",
    };
  }

  private getUserConversationsMock(
    userId: string,
    limit: number,
    cursor?: string,
  ) {
    const conversations = [...mockChatStore.conversations.values()].filter(
      (conversation) => conversation.participantIds.includes(userId),
    );

    let sorted = conversations.sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
    );

    if (cursor) {
      const cursorDate = new Date(cursor);
      if (!Number.isNaN(cursorDate.getTime())) {
        sorted = sorted.filter((conversation) =>
          conversation.updatedAt < cursorDate,
        );
      }
    }

    const page = sorted.slice(0, limit);
    const hasMore = sorted.length > page.length;
    const nextCursor = hasMore
      ? page[page.length - 1].updatedAt.toISOString()
      : null;

    return {
      success: true,
      data: {
        conversations: page.map(serializeMockConversation),
        hasMore,
        nextCursor,
      },
    };
  }

  private assertMockConversationParticipant(
    conversationId: string,
    userId: string,
  ) {
    const conversation = mockChatStore.conversations.get(conversationId);

    if (!conversation || !conversation.participantIds.includes(userId)) {
      throw new ForbiddenException(
        "You are not a participant in this conversation",
      );
    }

    return conversation;
  }

  private sendMessageMock(
    conversationId: string,
    userId: string,
    data: SendMessageDto,
  ) {
    const conversation = this.assertMockConversationParticipant(
      conversationId,
      userId,
    );

    const message: MockMessageRecord = {
      id: nextMockId("mock-msg"),
      conversationId,
      senderId: userId,
      content: data.content,
      messageType: data.messageType ?? "TEXT",
      createdAt: new Date(),
    };

    const existingMessages = mockChatStore.messages.get(conversationId);
    if (existingMessages) {
      existingMessages.unshift(message);
    } else {
      mockChatStore.messages.set(conversationId, [message]);
    }

    conversation.updatedAt = new Date();

    return {
      success: true,
      message: serializeMockMessage(message),
      timestamp: message.createdAt.toISOString(),
    };
  }

  private getMessagesMock(
    conversationId: string,
    userId: string,
    options: GetMessagesDto = {},
  ) {
    const conversation = this.assertMockConversationParticipant(
      conversationId,
      userId,
    );

    const messages = [...(mockChatStore.messages.get(conversationId) ?? [])];

    let filtered = messages;

    if (options.after) {
      filtered = filtered.filter((message) => message.createdAt > options.after);
    }

    if (options.before) {
      filtered = filtered.filter(
        (message) => message.createdAt < options.before,
      );
    }

    if (options.cursor) {
      const cursorDate = new Date(options.cursor);
      if (!Number.isNaN(cursorDate.getTime())) {
        filtered = filtered.filter((message) => message.createdAt < cursorDate);
      }
    }

    const limit = options.limit ?? 50;
    const page = filtered.slice(0, limit);
    const hasMore = filtered.length > page.length;
    const nextCursor = hasMore
      ? page[page.length - 1].createdAt.toISOString()
      : null;

    // Ensure conversation updatedAt reflects latest message retrieval
    conversation.updatedAt = new Date();

    return {
      success: true,
      data: {
        messages: page.map(serializeMockMessage),
        hasMore,
        nextCursor,
      },
    };
  }

  private markMessagesAsReadMock(
    conversationId: string,
    userId: string,
    messageIds: string[],
  ) {
    this.assertMockConversationParticipant(conversationId, userId);

    const availableMessages = mockChatStore.messages.get(conversationId) ?? [];
    const uniqueRequested = Array.from(new Set(messageIds));
    const marked = uniqueRequested.filter((messageId) =>
      availableMessages.some((message) => message.id === messageId),
    ).length;

    return {
      success: true,
      markedAsRead: marked,
      message: `Marked ${marked} messages as read`,
    };
  }

  private getUnreadCountMock(userId: string) {
    let count = 0;

    for (const conversation of mockChatStore.conversations.values()) {
      if (!conversation.participantIds.includes(userId)) {
        continue;
      }

      const messages = mockChatStore.messages.get(conversation.id) ?? [];
      count += messages.filter((message) => message.senderId !== userId).length;
    }

    return count;
  }

  private getConversationDetailsMock(
    conversationId: string,
    userId: string,
  ) {
    const conversation = mockChatStore.conversations.get(conversationId);

    if (!conversation || !conversation.participantIds.includes(userId)) {
      throw new NotFoundException(
        "Conversation not found or you are not a participant",
      );
    }

    return {
      success: true,
      conversation: serializeMockConversation(conversation),
    };
  }

  private addUserToConversationMock(
    conversationId: string,
    userId: string,
    addedByUserId: string,
  ) {
    const conversation = mockChatStore.conversations.get(conversationId);

    if (!conversation) {
      throw new NotFoundException("Conversation not found");
    }

    if (!conversation.participantIds.includes(addedByUserId)) {
      throw new ForbiddenException(
        "Only conversation participants can add users",
      );
    }

    if (conversation.participantIds.includes(userId)) {
      throw new BadRequestException("User is already in this conversation");
    }

    conversation.participantIds.push(userId);
    conversation.updatedAt = new Date();

    return {
      success: true,
      participant: {
        user: {
          id: userId,
        },
        userId,
        role: "MEMBER",
        joinedAt: new Date(),
      },
      message: "User added to conversation successfully",
    };
  }

  /**
   * Create a new conversation (direct or group)
   */
  async createConversation(userId: string, data: CreateConversationDto) {
    try {
      if (data.type !== "DIRECT" && data.type !== "GROUP") {
        throw new BadRequestException("Invalid conversation type");
      }

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

      if (isMockPrismaMode()) {
        return this.createConversationMock(userId, data);
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
      if (isMockPrismaMode()) {
        return this.getUserConversationsMock(userId, limit, cursor);
      }

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
      const MAX_MESSAGE_LENGTH = 10_000;

      if (data.content && data.content.length > MAX_MESSAGE_LENGTH) {
        throw new BadRequestException("Message content is too long");
      }

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

      if (isMockPrismaMode()) {
        return this.sendMessageMock(conversationId, userId, data);
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
      if (isMockPrismaMode()) {
        return this.getMessagesMock(conversationId, userId, options);
      }

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

      if (isMockPrismaMode()) {
        return this.markMessagesAsReadMock(conversationId, userId, messageIds);
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
      if (isMockPrismaMode()) {
        return this.getUnreadCountMock(userId);
      }

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

      if (isMockPrismaMode()) {
        return this.createConversationMock(user1Id, {
          type: "DIRECT",
          participantIds: [user2Id],
        });
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
      if (isMockPrismaMode()) {
        return this.addUserToConversationMock(
          conversationId,
          userId,
          addedByUserId,
        );
      }

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
      if (isMockPrismaMode()) {
        return this.getConversationDetailsMock(conversationId, userId);
      }

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
