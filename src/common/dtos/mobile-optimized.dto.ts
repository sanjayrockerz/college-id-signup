// Mobile-Optimized Response DTOs
export interface MobileUserDto {
  id: string;
  username: string;
  avatar?: string; // Compressed image URL
  isVerified: boolean;
  collegeName?: string;
  // Removed heavy fields like bio, full profile data
}

export interface MobileFeedDto {
  posts: MobilePostDto[];
  nextCursor?: string;
  hasMore: boolean;
  totalCount?: number; // For pagination
}

export interface MobilePostDto {
  id: string;
  content: string;
  images?: string[]; // Pre-compressed URLs
  isAnonymous: boolean;
  timeAgo: string; // Pre-calculated relative time
  author?: MobileUserDto;
  stats: {
    likes: number;
    comments: number;
    shares: number;
    coolness: number; // Average rating
  };
  userInteraction?: {
    liked: boolean;
    shared: boolean;
    rated?: number;
  };
}

export interface MobileConnectionDto {
  id: string;
  user: MobileUserDto;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'BLOCKED';
  isCloseFriend: boolean;
  mutualFriends?: number; // Pre-calculated
}
