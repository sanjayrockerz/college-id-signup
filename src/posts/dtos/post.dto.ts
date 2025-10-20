export interface CreatePostDto {
  content: string;
  imageUrls?: string[];
  isAnonymous?: boolean;
  visibility?: "PUBLIC" | "CONNECTIONS_ONLY" | "CLOSE_FRIENDS_ONLY" | "PRIVATE";
  allowComments?: boolean;
  allowSharing?: boolean;
}

export interface UpdatePostDto {
  content?: string;
  allowComments?: boolean;
  allowSharing?: boolean;
}

export interface PostResponseDto {
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
  updatedAt: Date;
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
  userInteractions?: {
    hasLiked: boolean;
    hasShared: boolean;
    coolnessRating?: number;
  };
}
