import { Injectable } from '@nestjs/common';
import { getPrismaClient } from '../../config/database';
import { CreatePostDto, UpdatePostDto } from '../dtos/post.dto';
// import { Prisma } from '@prisma/client';
import { Prisma } from '../../infra/prisma/mock-prisma-client';

@Injectable()
export class PostRepository {
  // Use the database singleton directly
  private get db() {
    return getPrismaClient();
  }

  async create(authorId: string, data: CreatePostDto) {
    return this.db.post.create({
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
                type: {
                  in: ['LIKE', 'LOVE', 'LAUGH', 'WOW', 'SAD', 'ANGRY'],
                },
              },
            },
            coolnessRatings: true,
          },
        },
      },
    });
  }

  async findById(id: string) {
    return this.db.post.findUnique({
      where: { id },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            profileImageUrl: true,
            isVerified: true,
          },
        },
        interactions: true,
        coolnessRatings: true,
        _count: {
          select: {
            interactions: {
              where: {
                type: {
                  in: ['LIKE', 'LOVE', 'LAUGH', 'WOW', 'SAD', 'ANGRY'],
                },
              },
            },
            coolnessRatings: true,
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
  ): Promise<{
    posts: any[];
    hasMore: boolean;
    nextCursor: string | null;
  }> {
    const where: Prisma.PostWhereInput = {};

    if (filters?.visibility) {
      where.visibility = { in: filters.visibility as any };
    }

    if (filters?.authorIds) {
      where.authorId = { in: filters.authorIds };
    }

    if (cursor) {
      where.createdAt = { lt: new Date(cursor) };
    }

    const posts = await this.db.post.findMany({
      where,
      include: {
        author: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            profileImageUrl: true,
            isVerified: true,
          },
        },
        _count: {
          select: {
            interactions: {
              where: {
                type: {
                  in: ['LIKE', 'LOVE', 'LAUGH', 'WOW', 'SAD', 'ANGRY'],
                },
              },
            },
            coolnessRatings: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });

    const hasMore = posts.length > limit;
    const postsToReturn = hasMore ? posts.slice(0, -1) : posts;
    const nextCursor = hasMore 
      ? postsToReturn[postsToReturn.length - 1].createdAt.toISOString() 
      : null;

    return {
      posts: postsToReturn,
      hasMore,
      nextCursor,
    };
  }

  async getAnonymousPostsToday(userId: string): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const count = await this.db.post.count({
      where: {
        authorId: userId,
        isAnonymous: true,
        createdAt: { gte: today },
      },
    });

    return count;
  }

  async incrementViewCount(postId: string) {
    return this.db.post.update({
      where: { id: postId },
      data: { viewCount: { increment: 1 } },
    });
  }

  async update(id: string, data: UpdatePostDto) {
    return this.db.post.update({
      where: { id },
      data: {
        content: data.content,
        allowComments: data.allowComments,
        allowSharing: data.allowSharing,
        updatedAt: new Date(),
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
      },
    });
  }

  async delete(id: string) {
    return this.db.post.delete({
      where: { id },
    });
  }

  async getConnectionIds(userId: string): Promise<string[]> {
    const connections = await this.db.connection.findMany({
      where: {
        OR: [
          { requesterId: userId, status: 'ACCEPTED' },
          { addresseeId: userId, status: 'ACCEPTED' },
        ],
      },
      select: {
        requesterId: true,
        addresseeId: true,
      },
    });

    return connections.map((conn) =>
      conn.requesterId === userId ? conn.addresseeId : conn.requesterId
    );
  }

  async getCloseFriendIds(userId: string): Promise<string[]> {
    const closeFriends = await this.db.connection.findMany({
      where: {
        OR: [
          { 
            requesterId: userId, 
            status: 'ACCEPTED',
            type: 'CLOSE_FRIEND'
          },
          { 
            addresseeId: userId, 
            status: 'ACCEPTED',
            type: 'CLOSE_FRIEND'
          },
        ],
      },
      select: {
        requesterId: true,
        addresseeId: true,
      },
    });

    return closeFriends.map((conn) =>
      conn.requesterId === userId ? conn.addresseeId : conn.requesterId
    );
  }
}
