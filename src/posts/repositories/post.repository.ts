import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CreatePostDto, UpdatePostDto } from '../dtos/post.dto';
// import { Prisma } from '@prisma/client';
import { Prisma } from '../../infra/prisma/mock-prisma-client';

@Injectable()
export class PostRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(authorId: string, data: CreatePostDto) {
    return this.prisma.post.create({
      data: {
        ...data,
        authorId,
      },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            profileImageUrl: true,
          },
        },
        _count: {
          select: {
            interactions: {
              where: {
                type: 'LIKE',
              },
            },
          },
        },
      },
    });
  }

  async findById(id: string) {
    return this.prisma.post.findUnique({
      where: { id },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            profileImageUrl: true,
          },
        },
        interactions: true,
        coolnessRatings: true,
        _count: {
          select: {
            interactions: {
              where: { type: 'LIKE' },
            },
          },
        },
      },
    });
  }

  async getPostsForUser(
    userId: string,
    cursor?: string,
    limit: number = 10,
    filters?: {
      visibility?: string[];
      authorIds?: string[];
    }
  ) {
    const where: Prisma.PostWhereInput = {
      ...(filters?.visibility && {
        visibility: {
          in: filters.visibility as any[],
        },
      }),
      ...(filters?.authorIds && {
        authorId: {
          in: filters.authorIds,
        },
      }),
    };

    const orderBy = { createdAt: 'desc' as const };
    
    if (cursor) {
      where.id = {
        lt: cursor,
      };
    }

    return this.prisma.post.findMany({
      where,
      include: {
        author: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            profileImageUrl: true,
          },
        },
        interactions: {
          where: {
            userId,
          },
        },
        coolnessRatings: {
          where: {
            userId,
          },
        },
        _count: {
          select: {
            interactions: {
              where: { type: 'LIKE' },
            },
          },
        },
      },
      orderBy,
      take: limit,
    });
  }

  async getAnonymousPostsToday(userId: string): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const count = await this.prisma.post.count({
      where: {
        authorId: userId,
        isAnonymous: true,
        createdAt: {
          gte: today,
          lt: tomorrow,
        },
      },
    });

    return count;
  }

  async incrementViewCount(postId: string) {
    return this.prisma.post.update({
      where: { id: postId },
      data: {
        viewCount: {
          increment: 1,
        },
      },
    });
  }

  async update(id: string, data: UpdatePostDto) {
    return this.prisma.post.update({
      where: { id },
      data,
      include: {
        author: {
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
  }

  async delete(id: string) {
    return this.prisma.post.delete({
      where: { id },
    });
  }

  async getConnectionsPosts(userId: string, limit: number = 10, cursor?: string) {
    // Get accepted connections
    const connections = await this.prisma.connection.findMany({
      where: {
        OR: [
          { requesterId: userId, status: 'ACCEPTED' },
          { receiverId: userId, status: 'ACCEPTED' },
        ],
      },
      select: {
        requesterId: true,
        receiverId: true,
      },
    });

    const connectedUserIds = connections.map(conn => 
      conn.requesterId === userId ? conn.receiverId : conn.requesterId
    );

    return this.getPostsForUser(userId, cursor, limit, {
      authorIds: connectedUserIds,
      visibility: ['PUBLIC', 'CONNECTIONS_ONLY'],
    });
  }

  async getCloseFriendsPosts(userId: string, limit: number = 10, cursor?: string) {
    // Get close friend connections
    const closeFriends = await this.prisma.connection.findMany({
      where: {
        OR: [
          { requesterId: userId, status: 'ACCEPTED', isCloseFriend: true },
          { receiverId: userId, status: 'ACCEPTED', isCloseFriend: true },
        ],
      },
      select: {
        requesterId: true,
        receiverId: true,
      },
    });

    const closeFriendIds = closeFriends.map(conn => 
      conn.requesterId === userId ? conn.receiverId : conn.requesterId
    );

    return this.getPostsForUser(userId, cursor, limit, {
      authorIds: closeFriendIds,
      visibility: ['PUBLIC', 'CONNECTIONS_ONLY', 'CLOSE_FRIENDS_ONLY'],
    });
  }
}
