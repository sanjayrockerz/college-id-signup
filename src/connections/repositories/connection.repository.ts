import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Injectable()
export class ConnectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(requesterId: string, receiverId: string) {
    // TODO: Implement after Prisma setup
    return {
      id: 'temp-id',
      requesterId,
      receiverId,
      status: 'PENDING',
      isCloseFriend: false,
      createdAt: new Date(),
    };
  }

  async findByUsers(requesterId: string, receiverId: string) {
    // TODO: Implement after Prisma setup
    return null;
  }

  async updateStatus(id: string, status: string, isCloseFriend?: boolean) {
    // TODO: Implement after Prisma setup
    return {
      id,
      status,
      isCloseFriend: isCloseFriend || false,
      updatedAt: new Date(),
    };
  }

  async getUserConnections(userId: string, status?: string) {
    // TODO: Implement after Prisma setup
    return [];
  }

  async delete(id: string) {
    // TODO: Implement after Prisma setup
    return { success: true };
  }
}
