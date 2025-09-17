import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  BadRequestException,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ChatService } from '../services/chat.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

// Request interfaces
interface CreateConversationRequest {
  type: 'DIRECT' | 'GROUP';
  title?: string;
  description?: string;
  participantIds: string[];
}

interface SendMessageRequest {
  content: string;
  messageType?: 'TEXT' | 'IMAGE' | 'FILE' | 'VOICE';
  attachments?: {
    filename: string;
    mimetype: string;
    url: string;
    size: number;
  }[];
}

interface MarkReadRequest {
  messageIds: string[];
}

interface AddUserRequest {
  userId: string;
}

@Controller('api/v1/chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * Create a new conversation
   * POST /api/v1/chat/conversations
   */
  @Post('conversations')
  async createConversation(
    @Request() req: any,
    @Body() createConversationDto: CreateConversationRequest
  ) {
    const userId = req.user.sub;
    
    // Validate request
    if (!createConversationDto.type || !createConversationDto.participantIds) {
      throw new BadRequestException('Type and participantIds are required');
    }

    if (!Array.isArray(createConversationDto.participantIds)) {
      throw new BadRequestException('participantIds must be an array');
    }

    return await this.chatService.createConversation(userId, createConversationDto);
  }

  /**
   * Get user's conversations
   * GET /api/v1/chat/conversations
   */
  @Get('conversations')
  async getUserConversations(
    @Request() req: any,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string
  ) {
    const userId = req.user.sub;
    
    // Validate limit
    if (limit > 100) {
      throw new BadRequestException('Limit cannot be greater than 100');
    }

    return await this.chatService.getUserConversations(userId, limit, cursor);
  }

  /**
   * Get conversation details
   * GET /api/v1/chat/conversations/:conversationId
   */
  @Get('conversations/:conversationId')
  async getConversationDetails(
    @Request() req: any,
    @Param('conversationId') conversationId: string
  ) {
    const userId = req.user.sub;
    return await this.chatService.getConversationDetails(conversationId, userId);
  }

  /**
   * Send a message in a conversation
   * POST /api/v1/chat/conversations/:conversationId/messages
   */
  @Post('conversations/:conversationId/messages')
  async sendMessage(
    @Request() req: any,
    @Param('conversationId') conversationId: string,
    @Body() sendMessageDto: SendMessageRequest
  ) {
    const userId = req.user.sub;
    
    // Validate request
    if (!sendMessageDto.content?.trim() && (!sendMessageDto.attachments || sendMessageDto.attachments.length === 0)) {
      throw new BadRequestException('Message must have content or attachments');
    }

    return await this.chatService.sendMessage(conversationId, userId, sendMessageDto);
  }

  /**
   * Get messages from a conversation
   * GET /api/v1/chat/conversations/:conversationId/messages
   */
  @Get('conversations/:conversationId/messages')
  async getMessages(
    @Request() req: any,
    @Param('conversationId') conversationId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
    @Query('before') before?: string,
    @Query('after') after?: string
  ) {
    const userId = req.user.sub;
    
    // Validate limit
    if (limit > 100) {
      throw new BadRequestException('Limit cannot be greater than 100');
    }

    const options = {
      limit,
      cursor,
      before: before ? new Date(before) : undefined,
      after: after ? new Date(after) : undefined,
    };

    return await this.chatService.getMessages(conversationId, userId, options);
  }

  /**
   * Mark messages as read
   * PUT /api/v1/chat/conversations/:conversationId/messages/read
   */
  @Put('conversations/:conversationId/messages/read')
  async markMessagesAsRead(
    @Request() req: any,
    @Param('conversationId') conversationId: string,
    @Body() markReadDto: MarkReadRequest
  ) {
    const userId = req.user.sub;
    
    if (!markReadDto.messageIds || !Array.isArray(markReadDto.messageIds)) {
      throw new BadRequestException('messageIds must be an array');
    }

    return await this.chatService.markMessagesAsRead(conversationId, userId, markReadDto.messageIds);
  }

  /**
   * Get unread message count
   * GET /api/v1/chat/unread-count
   */
  @Get('unread-count')
  async getUnreadCount(@Request() req: any) {
    const userId = req.user.sub;
    const count = await this.chatService.getUnreadCount(userId);
    
    return {
      success: true,
      unreadCount: count,
    };
  }

  /**
   * Create or get direct message conversation
   * POST /api/v1/chat/direct-messages
   */
  @Post('direct-messages')
  async createDirectMessage(
    @Request() req: any,
    @Body() body: { userId: string }
  ) {
    const currentUserId = req.user.sub;
    
    if (!body.userId) {
      throw new BadRequestException('userId is required');
    }

    if (body.userId === currentUserId) {
      throw new BadRequestException('Cannot create conversation with yourself');
    }

    return await this.chatService.findOrCreateDirectMessage(currentUserId, body.userId);
  }

  /**
   * Add user to group conversation
   * POST /api/v1/chat/conversations/:conversationId/participants
   */
  @Post('conversations/:conversationId/participants')
  async addUserToConversation(
    @Request() req: any,
    @Param('conversationId') conversationId: string,
    @Body() addUserDto: AddUserRequest
  ) {
    const currentUserId = req.user.sub;
    
    if (!addUserDto.userId) {
      throw new BadRequestException('userId is required');
    }

    return await this.chatService.addUserToConversation(
      conversationId,
      addUserDto.userId,
      currentUserId
    );
  }

  /**
   * Search messages in a conversation
   * GET /api/v1/chat/conversations/:conversationId/search
   */
  @Get('conversations/:conversationId/search')
  async searchMessages(
    @Request() req: any,
    @Param('conversationId') conversationId: string,
    @Query('q') query: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number
  ) {
    const userId = req.user.sub;
    
    if (!query?.trim()) {
      throw new BadRequestException('Search query is required');
    }

    if (limit > 50) {
      throw new BadRequestException('Limit cannot be greater than 50');
    }

    return await this.chatService.searchMessages(conversationId, userId, query, limit);
  }

  /**
   * Get conversation statistics
   * GET /api/v1/chat/conversations/:conversationId/stats
   */
  @Get('conversations/:conversationId/stats')
  async getConversationStats(
    @Request() req: any,
    @Param('conversationId') conversationId: string
  ) {
    const userId = req.user.sub;
    return await this.chatService.getConversationStats(conversationId, userId);
  }

  /**
   * Health check endpoint for chat service
   * GET /api/v1/chat/health
   */
  @Get('health')
  async healthCheck() {
    return {
      success: true,
      service: 'chat',
      status: 'healthy',
      timestamp: new Date().toISOString(),
      features: {
        directMessages: true,
        groupChats: true,
        attachments: true,
        readReceipts: true,
        messageSearch: 'coming-soon',
        realTimeNotifications: 'planned',
      },
    };
  }
}
