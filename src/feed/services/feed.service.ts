import { Injectable } from '@nestjs/common';
import { FeedRequestDto, FeedResponseDto } from '../dtos/feed.dto';
import { PostResponseDto } from '../../posts/dtos/post.dto';
import { FeedRepository } from '../repositories/feed.repository';

@Injectable()
export class FeedService {
  constructor(private readonly feedRepository: FeedRepository) {}

  async getFeedForUser(userId: string, feedRequest: FeedRequestDto): Promise<FeedResponseDto> {
    const { cursor, limit = 10, type = 'all' } = feedRequest;

    let posts: PostResponseDto[] = [];

    switch (type) {
      case 'connections':
        posts = await this.getConnectionsFeed(userId, limit, cursor);
        break;
      case 'trending':
        posts = await this.getTrendingFeed(limit, cursor);
        break;
      default:
        posts = await this.getAllFeed(userId, limit, cursor);
    }

    // Calculate next cursor
    const nextCursor = posts.length === limit ? posts[posts.length - 1]?.id : undefined;
    const hasMore = posts.length === limit;

    return {
      posts,
      nextCursor,
      hasMore,
    };
  }

  private async getAllFeed(userId: string, limit: number, cursor?: string): Promise<PostResponseDto[]> {
    // Algorithm: Connection-first feed
    // 1. Get posts from connections (70% weight)
    // 2. Get trending/popular posts (20% weight)
    // 3. Get random public posts (10% weight)
    
    // TODO: Implement actual algorithm with repositories
    return this.getMockPosts(limit);
  }

  private async getConnectionsFeed(userId: string, limit: number, cursor?: string): Promise<PostResponseDto[]> {
    // Get posts only from accepted connections
    // TODO: Implement with actual repository
    return this.getMockPosts(limit);
  }

  private async getTrendingFeed(limit: number, cursor?: string): Promise<PostResponseDto[]> {
    // Get posts sorted by coolness rating and recent engagement
    // TODO: Implement with actual repository
    return this.getMockPosts(limit);
  }

  private getMockPosts(limit: number): PostResponseDto[] {
    // Mock data for testing
    const mockPosts: PostResponseDto[] = [];
    
    for (let i = 0; i < Math.min(limit, 5); i++) {
      mockPosts.push({
        id: `mock-post-${i}`,
        content: `This is mock post content ${i + 1}`,
        imageUrls: [],
        isAnonymous: i % 3 === 0,
        visibility: 'PUBLIC',
        allowComments: true,
        allowSharing: true,
        viewCount: Math.floor(Math.random() * 1000),
        shareCount: Math.floor(Math.random() * 50),
        createdAt: new Date(Date.now() - i * 3600000), // Hours ago
        updatedAt: new Date(Date.now() - i * 3600000),
        author: i % 3 === 0 ? undefined : {
          id: `user-${i}`,
          username: `user${i}`,
          firstName: `User`,
          lastName: `${i}`,
          profileImageUrl: null,
        },
        interactionCounts: {
          likes: Math.floor(Math.random() * 100),
          comments: Math.floor(Math.random() * 20),
          shares: Math.floor(Math.random() * 10),
        },
        coolnessRating: Math.floor(Math.random() * 5) + 1,
      });
    }

    return mockPosts;
  }

  async getPersonalizedFeed(userId: string, limit: number, cursor?: string): Promise<PostResponseDto[]> {
    // Advanced algorithm implementation
    // TODO: Implement ML-based personalization
    return this.getMockPosts(limit);
  }
}
