import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
// Use the singleton database client
import { prisma, connectDatabase, disconnectDatabase, checkDatabaseHealth } from '../../config/database';
// import { PrismaClient } from '@prisma/client';
// import { PrismaClient } from './mock-prisma-client';
import { DatabaseConfigService } from '../config/database.config';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly databaseConfig = new DatabaseConfigService();

  // Use the singleton instance instead of extending PrismaClient
  get client() {
    return prisma;
  }

  // Delegate all Prisma methods to the singleton client
  get user() { return prisma.user; }
  get post() { return prisma.post; }
  get interaction() { return prisma.interaction; }
  get connection() { return prisma.connection; }
  get coolnessRating() { return prisma.coolnessRating; }
  get push() { return prisma.push; }
  get postView() { return prisma.postView; }
  
  // Chat models
  get conversation() { return prisma.conversation; }
  get conversationUser() { return prisma.conversationUser; }
  get message() { return prisma.message; }
  get messageRead() { return prisma.messageRead; }
  get attachment() { return prisma.attachment; }

  // Prisma client methods
  get $connect() { return prisma.$connect.bind(prisma); }
  get $disconnect() { return prisma.$disconnect.bind(prisma); }
  get $transaction() { return prisma.$transaction.bind(prisma); }
  get $queryRaw() { return prisma.$queryRaw.bind(prisma); }
  get $executeRaw() { return prisma.$executeRaw.bind(prisma); }
  get $queryRawUnsafe() { return prisma.$queryRawUnsafe.bind(prisma); }
  get $executeRawUnsafe() { return prisma.$executeRawUnsafe.bind(prisma); }

  async onModuleInit() {
    try {
      // Use the singleton's connect method
      await connectDatabase();
      this.logger.log('Successfully connected to PostgreSQL database via singleton');
    } catch (error) {
      this.logger.error('Failed to connect to database:', error);
      
      // Fall back to mock client in development if real database is not available
      if (this.databaseConfig.isDevelopment) {
        this.logger.warn('Falling back to mock client for development');
        // In a real implementation, you might want to dynamically switch here
        // For now, we'll let the error propagate
      }
      throw error;
    }
  }

  async onModuleDestroy() {
    // Note: We don't disconnect the singleton here as other parts of the app might still need it
    // The singleton handles its own cleanup via process event handlers
    this.logger.log('PrismaService destroyed (singleton connection remains active)');
  }

  // Helper method to check database health
  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; latency?: number }> {
    const health = await checkDatabaseHealth();
    return {
      status: health.status,
      latency: health.latency ? parseInt(health.latency.replace('ms', '')) : undefined
    };
  }

  // Helper method for transactional operations
  async executeTransaction<T>(
    fn: (prisma: any) => Promise<T>
  ): Promise<T> {
    return prisma.$transaction(fn);
  }

  // Chat-specific helper methods
  async findActiveConversationsForUser(userId: string, limit = 50) {
    return prisma.conversation.findMany({
      where: {
        conversationUsers: {
          some: {
            userId,
            isActive: true,
          },
        },
        isActive: true,
      },
      include: {
        conversationUsers: {
          where: { isActive: true },
          include: { user: true },
        },
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          include: {
            sender: true,
            attachments: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
  }

  async findDirectConversation(userId1: string, userId2: string) {
    return prisma.conversation.findFirst({
      where: {
        type: 'DIRECT_MESSAGE',
        AND: [
          {
            conversationUsers: {
              some: { userId: userId1, isActive: true },
            },
          },
          {
            conversationUsers: {
              some: { userId: userId2, isActive: true },
            },
          },
        ],
        isActive: true,
      },
      include: {
        conversationUsers: {
          where: { isActive: true },
          include: { user: true },
        },
      },
    });
  }

  async getUnreadMessageCount(userId: string, conversationId: string): Promise<number> {
    const conversationUser = await prisma.conversationUser.findUnique({
      where: {
        userId_conversationId: {
          userId,
          conversationId,
        },
      },
    });

    if (!conversationUser?.lastReadAt) {
      return prisma.message.count({
        where: {
          conversationId,
          senderId: { not: userId },
          isDeleted: false,
        },
      });
    }

    return prisma.message.count({
      where: {
        conversationId,
        senderId: { not: userId },
        createdAt: { gt: conversationUser.lastReadAt },
        isDeleted: false,
      },
    });
  }
}