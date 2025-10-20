export interface FeedRequestDto {
  cursor?: string;
  limit?: number;
  type?: "all" | "connections" | "trending";
}

export interface FeedResponseDto {
  posts: Array<{
    id: string;
    content: string;
    imageUrls: string[];
    isAnonymous: boolean;
    visibility: string;
    allowComments: boolean;
    allowSharing: boolean;
    viewCount: number;
    shareCount: number;
    createdAt: Date;
    author?: {
      id: string;
      username: string;
      firstName?: string;
      lastName?: string;
      profileImageUrl?: string;
    };
    interactionCounts: {
      likes: number;
      comments: number;
      shares: number;
    };
    coolnessRating: number;
  }>;
  nextCursor?: string;
  hasMore: boolean;
}
