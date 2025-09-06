// Mock Prisma client types for development
export interface User {
  id: string;
  email: string;
  username: string;
  firstName?: string;
  lastName?: string;
  bio?: string;
  profileImageUrl?: string;
  isVerified: boolean;
  verifiedCollegeId?: string;
  collegeName?: string;
  studentIdNumber?: string;
  graduationYear?: number;
  anonymousPostsToday: number;
  weeklyPushesUsed: number;
  lastAnonymousPostDate?: Date;
  lastWeeklyReset: Date;
  allowDirectMessages: boolean;
  showOnlineStatus: boolean;
  profileVisibility: string;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date;
}

export interface Post {
  id: string;
  content: string;
  imageUrls: string[];
  isAnonymous: boolean;
  visibility: string;
  allowComments: boolean;
  allowSharing: boolean;
  viewCount: number;
  shareCount: number;
  authorId: string;
  createdAt: Date;
  updatedAt: Date;
  author?: User;
  interactions?: Interaction[];
  _count?: any;
}

export interface Interaction {
  id: string;
  type: string;
  userId: string;
  postId: string;
  createdAt: Date;
  user?: User;
  post?: Post;
}

export interface Connection {
  id: string;
  requesterId: string;
  receiverId: string;
  status: string;
  isCloseFriend: boolean;
  createdAt: Date;
  updatedAt: Date;
  requester?: User;
  receiver?: User;
}

export interface CoolnessRating {
  id: string;
  userId: string;
  postId: string;
  rating: number;
  createdAt: Date;
  user?: User;
  post?: Post;
}

export interface PostView {
  id: string;
  userId: string;
  postId: string;
  createdAt: Date;
  user?: User;
  post?: Post;
}

export interface Push {
  id: string;
  userId: string;
  postId: string;
  createdAt: Date;
  user?: User;
  post?: Post;
}

export interface MockPrismaClient {
  user: {
    create: (args: any) => Promise<User>;
    findUnique: (args: any) => Promise<User | null>;
    findMany: (args: any) => Promise<User[]>;
    update: (args: any) => Promise<User>;
    delete: (args: any) => Promise<User>;
    count: (args: any) => Promise<number>;
  };
  post: {
    create: (args: any) => Promise<Post>;
    findUnique: (args: any) => Promise<Post | null>;
    findMany: (args: any) => Promise<Post[]>;
    update: (args: any) => Promise<Post>;
    delete: (args: any) => Promise<Post>;
    count: (args: any) => Promise<number>;
  };
  interaction: {
    create: (args: any) => Promise<Interaction>;
    findUnique: (args: any) => Promise<Interaction | null>;
    findMany: (args: any) => Promise<Interaction[]>;
    update: (args: any) => Promise<Interaction>;
    delete: (args: any) => Promise<Interaction>;
    count: (args: any) => Promise<number>;
  };
  connection: {
    create: (args: any) => Promise<Connection>;
    findUnique: (args: any) => Promise<Connection | null>;
    findMany: (args: any) => Promise<Connection[]>;
    update: (args: any) => Promise<Connection>;
    delete: (args: any) => Promise<Connection>;
    count: (args: any) => Promise<number>;
  };
  coolnessRating: {
    create: (args: any) => Promise<CoolnessRating>;
    findUnique: (args: any) => Promise<CoolnessRating | null>;
    findMany: (args: any) => Promise<CoolnessRating[]>;
    update: (args: any) => Promise<CoolnessRating>;
    delete: (args: any) => Promise<CoolnessRating>;
    count: (args: any) => Promise<number>;
  };
  postView: {
    create: (args: any) => Promise<PostView>;
    findUnique: (args: any) => Promise<PostView | null>;
    findMany: (args: any) => Promise<PostView[]>;
    update: (args: any) => Promise<PostView>;
    delete: (args: any) => Promise<PostView>;
    count: (args: any) => Promise<number>;
  };
  push: {
    create: (args: any) => Promise<Push>;
    findUnique: (args: any) => Promise<Push | null>;
    findMany: (args: any) => Promise<Push[]>;
    update: (args: any) => Promise<Push>;
    delete: (args: any) => Promise<Push>;
    count: (args: any) => Promise<number>;
  };
  $connect: () => Promise<void>;
  $disconnect: () => Promise<void>;
}

export class PrismaClient implements MockPrismaClient {
  public readonly __isMockClient = true;

  user = {
    create: async (args: any): Promise<User> => {
      // Mock implementation
      return {
        id: 'mock-id',
        email: args.data.email,
        username: args.data.username,
        firstName: args.data.firstName,
        lastName: args.data.lastName,
        bio: args.data.bio,
        profileImageUrl: args.data.profileImageUrl,
        isVerified: args.data.isVerified || false,
        verifiedCollegeId: args.data.verifiedCollegeId,
        collegeName: args.data.collegeName,
        studentIdNumber: args.data.studentIdNumber,
        graduationYear: args.data.graduationYear,
        anonymousPostsToday: 0,
        weeklyPushesUsed: 0,
        lastWeeklyReset: new Date(),
        allowDirectMessages: true,
        showOnlineStatus: true,
        profileVisibility: 'PUBLIC',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },
    findUnique: async (args: any): Promise<User | null> => null,
    findMany: async (args: any): Promise<User[]> => [],
    update: async (args: any): Promise<User> => ({} as User),
    delete: async (args: any): Promise<User> => ({} as User),
    count: async (args: any): Promise<number> => 0,
  };

  post = {
    create: async (args: any): Promise<Post> => ({} as Post),
    findUnique: async (args: any): Promise<Post | null> => null,
    findMany: async (args: any): Promise<Post[]> => [],
    update: async (args: any): Promise<Post> => ({} as Post),
    delete: async (args: any): Promise<Post> => ({} as Post),
    count: async (args: any): Promise<number> => 0,
  };

  interaction = {
    create: async (args: any): Promise<Interaction> => ({} as Interaction),
    findUnique: async (args: any): Promise<Interaction | null> => null,
    findMany: async (args: any): Promise<Interaction[]> => [],
    update: async (args: any): Promise<Interaction> => ({} as Interaction),
    delete: async (args: any): Promise<Interaction> => ({} as Interaction),
    count: async (args: any): Promise<number> => 0,
  };

  connection = {
    create: async (args: any): Promise<Connection> => ({} as Connection),
    findUnique: async (args: any): Promise<Connection | null> => null,
    findMany: async (args: any): Promise<Connection[]> => [],
    update: async (args: any): Promise<Connection> => ({} as Connection),
    delete: async (args: any): Promise<Connection> => ({} as Connection),
    count: async (args: any): Promise<number> => 0,
  };

  coolnessRating = {
    create: async (args: any): Promise<CoolnessRating> => ({} as CoolnessRating),
    findUnique: async (args: any): Promise<CoolnessRating | null> => null,
    findMany: async (args: any): Promise<CoolnessRating[]> => [],
    update: async (args: any): Promise<CoolnessRating> => ({} as CoolnessRating),
    delete: async (args: any): Promise<CoolnessRating> => ({} as CoolnessRating),
    count: async (args: any): Promise<number> => 0,
  };

  postView = {
    create: async (args: any): Promise<PostView> => ({} as PostView),
    findUnique: async (args: any): Promise<PostView | null> => null,
    findMany: async (args: any): Promise<PostView[]> => [],
    update: async (args: any): Promise<PostView> => ({} as PostView),
    delete: async (args: any): Promise<PostView> => ({} as PostView),
    count: async (args: any): Promise<number> => 0,
  };

  push = {
    create: async (args: any): Promise<Push> => ({} as Push),
    findUnique: async (args: any): Promise<Push | null> => null,
    findMany: async (args: any): Promise<Push[]> => [],
    update: async (args: any): Promise<Push> => ({} as Push),
    delete: async (args: any): Promise<Push> => ({} as Push),
    count: async (args: any): Promise<number> => 0,
  };

  async $connect(): Promise<void> {
    // Mock connection - always succeeds
    return Promise.resolve();
  }

  async $disconnect(): Promise<void> {
    // Mock disconnection - always succeeds
    return Promise.resolve();
  }

  // Transaction support
  async $transaction(fn: any) {
    return await fn(this);
  }
}

export namespace Prisma {
  export interface PostWhereInput {
    id?: string | { lt?: string; gt?: string; in?: string[] };
    authorId?: string | { in?: string[] };
    visibility?: string | { in?: string[] };
    AND?: PostWhereInput[];
    OR?: PostWhereInput[];
    author?: UserWhereInput;
  }

  export interface UserWhereInput {
    id?: string | { in?: string[] };
    username?: string;
    email?: string;
  }

  export interface PostOrderByInput {
    createdAt?: 'asc' | 'desc';
    updatedAt?: 'asc' | 'desc';
    viewCount?: 'asc' | 'desc';
  }

  export interface PostCreateInput {
    content: string;
    imageUrls?: string[];
    isAnonymous?: boolean;
    visibility?: string;
    allowComments?: boolean;
    allowSharing?: boolean;
    author: {
      connect: { id: string };
    };
  }

  export interface PostUpdateInput {
    content?: string;
    allowComments?: boolean;
    allowSharing?: boolean;
    viewCount?: number;
    shareCount?: number;
  }

  export interface ConnectionWhereInput {
    requesterId?: string;
    receiverId?: string;
    status?: string;
    isCloseFriend?: boolean;
    OR?: ConnectionWhereInput[];
  }
}

export const Prisma = {
  SortOrder: {
    asc: 'asc',
    desc: 'desc',
  },
  VisibilityType: {
    PUBLIC: 'PUBLIC',
    CONNECTIONS_ONLY: 'CONNECTIONS_ONLY',
    CLOSE_FRIENDS_ONLY: 'CLOSE_FRIENDS_ONLY',
    PRIVATE: 'PRIVATE',
  },
  InteractionType: {
    LIKE: 'LIKE',
    COMMENT: 'COMMENT',
    SHARE: 'SHARE',
    VIEW: 'VIEW',
  },
  ConnectionStatus: {
    PENDING: 'PENDING',
    ACCEPTED: 'ACCEPTED',
    REJECTED: 'REJECTED',
    BLOCKED: 'BLOCKED',
  },
};
