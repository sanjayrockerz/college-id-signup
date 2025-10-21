// Mock Prisma client types for development
export interface User {
  id: string;
  email: string;
  username: string;
  firstName?: string;
  lastName?: string;
  bio?: string;
  profileImageUrl?: string;
  anonymousPostsToday: number;
  weeklyPushesUsed: number;
  lastAnonymousPostDate?: Date;
  lastWeeklyReset: Date;
  allowDirectMessages: boolean;
  showOnlineStatus: boolean;
  profileVisibility: string;
  isOnline: boolean;
  lastSeenAt?: Date;
  typingIn?: string | null;
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

// Chat models
export interface Conversation {
  id: string;
  name?: string;
  description?: string;
  type: string;
  avatarUrl?: string;
  isActive: boolean;
  allowMemberAdd: boolean;
  allowFileSharing: boolean;
  maxMembers?: number;
  lastMessageAt?: Date;
  lastMessageId?: string;
  createdAt: Date;
  updatedAt: Date;
  creatorId: string;
  creator?: User;
  conversationUsers?: ConversationUser[];
  messages?: Message[];
  participants?: ConversationUser[];
  _count?: any;
}

export interface ConversationUser {
  id: string;
  role: string;
  isActive: boolean;
  isMuted: boolean;
  mutedUntil?: Date;
  joinedAt: Date;
  leftAt?: Date;
  lastReadAt?: Date;
  lastReadMessageId?: string;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
  user?: User;
  conversationId: string;
  conversation?: Conversation;
}

export interface Message {
  id: string;
  content?: string;
  type: string;
  status: string;
  isEdited: boolean;
  editedAt?: Date;
  isDeleted: boolean;
  deletedAt?: Date;
  replyToId?: string;
  threadId?: string;
  metadata?: any;
  createdAt: Date;
  updatedAt: Date;
  senderId: string;
  sender?: User;
  conversationId: string;
  conversation?: Conversation;
  replyTo?: Message;
  replies?: Message[];
  attachments?: Attachment[];
  messageReads?: MessageRead[];
}

export interface MessageRead {
  id: string;
  readAt: Date;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
  user?: User;
  messageId: string;
  message?: Message;
}

export interface Attachment {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  thumbnailUrl?: string;
  type: string;
  width?: number;
  height?: number;
  duration?: number;
  createdAt: Date;
  updatedAt: Date;
  uploaderId: string;
  uploader?: User;
  messageId?: string;
  message?: Message;
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
  conversation: {
    create: (args: any) => Promise<Conversation>;
    findUnique: (args: any) => Promise<Conversation | null>;
    findMany: (args: any) => Promise<Conversation[]>;
    findFirst: (args: any) => Promise<Conversation | null>;
    update: (args: any) => Promise<Conversation>;
    delete: (args: any) => Promise<Conversation>;
    count: (args: any) => Promise<number>;
  };
  conversationUser: {
    create: (args: any) => Promise<ConversationUser>;
    createMany: (args: any) => Promise<{ count: number }>;
    findUnique: (args: any) => Promise<ConversationUser | null>;
    findFirst: (args: any) => Promise<ConversationUser | null>;
    findMany: (args: any) => Promise<ConversationUser[]>;
    update: (args: any) => Promise<ConversationUser>;
    delete: (args: any) => Promise<ConversationUser>;
    count: (args: any) => Promise<number>;
  };
  message: {
    create: (args: any) => Promise<Message>;
    findUnique: (args: any) => Promise<Message | null>;
    findMany: (args: any) => Promise<Message[]>;
    update: (args: any) => Promise<Message>;
    delete: (args: any) => Promise<Message>;
    count: (args: any) => Promise<number>;
  };
  messageRead: {
    create: (args: any) => Promise<MessageRead>;
    findUnique: (args: any) => Promise<MessageRead | null>;
    findMany: (args: any) => Promise<MessageRead[]>;
    update: (args: any) => Promise<MessageRead>;
    upsert: (args: any) => Promise<MessageRead>;
    delete: (args: any) => Promise<MessageRead>;
    count: (args: any) => Promise<number>;
  };
  attachment: {
    create: (args: any) => Promise<Attachment>;
    findUnique: (args: any) => Promise<Attachment | null>;
    findMany: (args: any) => Promise<Attachment[]>;
    update: (args: any) => Promise<Attachment>;
    delete: (args: any) => Promise<Attachment>;
    count: (args: any) => Promise<number>;
  };
  $connect: () => Promise<void>;
  $disconnect: () => Promise<void>;
  $transaction: (fn: any) => Promise<any>;
  $queryRaw: (query: any) => Promise<any>;
}

export class PrismaClient implements MockPrismaClient {
  public readonly __isMockClient = true;

  user = {
    create: async (args: any): Promise<User> => {
      // Mock implementation
      return {
        id: "mock-id",
        email: args.data.email,
        username: args.data.username,
        firstName: args.data.firstName,
        lastName: args.data.lastName,
        bio: args.data.bio,
        profileImageUrl: args.data.profileImageUrl,
        anonymousPostsToday: 0,
        weeklyPushesUsed: 0,
        lastWeeklyReset: new Date(),
        allowDirectMessages: true,
        showOnlineStatus: true,
        profileVisibility: "PUBLIC",
        isOnline: false,
        typingIn: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSeenAt: new Date(),
      };
    },
  findUnique: async (_args: any): Promise<User | null> => null,
  findMany: async (_args: any): Promise<User[]> => [],
  update: async (_args: any): Promise<User> => ({}) as User,
  delete: async (_args: any): Promise<User> => ({}) as User,
  count: async (_args: any): Promise<number> => 0,
  };

  post = {
  create: async (_args: any): Promise<Post> => ({}) as Post,
  findUnique: async (_args: any): Promise<Post | null> => null,
  findMany: async (_args: any): Promise<Post[]> => [],
  update: async (_args: any): Promise<Post> => ({}) as Post,
  delete: async (_args: any): Promise<Post> => ({}) as Post,
  count: async (_args: any): Promise<number> => 0,
  };

  interaction = {
  create: async (_args: any): Promise<Interaction> => ({}) as Interaction,
  findUnique: async (_args: any): Promise<Interaction | null> => null,
  findMany: async (_args: any): Promise<Interaction[]> => [],
  update: async (_args: any): Promise<Interaction> => ({}) as Interaction,
  delete: async (_args: any): Promise<Interaction> => ({}) as Interaction,
  count: async (_args: any): Promise<number> => 0,
  };

  connection = {
  create: async (_args: any): Promise<Connection> => ({}) as Connection,
  findUnique: async (_args: any): Promise<Connection | null> => null,
  findMany: async (_args: any): Promise<Connection[]> => [],
  update: async (_args: any): Promise<Connection> => ({}) as Connection,
  delete: async (_args: any): Promise<Connection> => ({}) as Connection,
  count: async (_args: any): Promise<number> => 0,
  };

  coolnessRating = {
    create: async (_args: any): Promise<CoolnessRating> =>
      ({}) as CoolnessRating,
    findUnique: async (_args: any): Promise<CoolnessRating | null> => null,
    findMany: async (_args: any): Promise<CoolnessRating[]> => [],
    update: async (_args: any): Promise<CoolnessRating> =>
      ({}) as CoolnessRating,
    delete: async (_args: any): Promise<CoolnessRating> =>
      ({}) as CoolnessRating,
    count: async (_args: any): Promise<number> => 0,
  };

  postView = {
  create: async (_args: any): Promise<PostView> => ({}) as PostView,
  findUnique: async (_args: any): Promise<PostView | null> => null,
  findMany: async (_args: any): Promise<PostView[]> => [],
  update: async (_args: any): Promise<PostView> => ({}) as PostView,
  delete: async (_args: any): Promise<PostView> => ({}) as PostView,
  count: async (_args: any): Promise<number> => 0,
  };

  push = {
  create: async (_args: any): Promise<Push> => ({}) as Push,
  findUnique: async (_args: any): Promise<Push | null> => null,
  findMany: async (_args: any): Promise<Push[]> => [],
  update: async (_args: any): Promise<Push> => ({}) as Push,
  delete: async (_args: any): Promise<Push> => ({}) as Push,
  count: async (_args: any): Promise<number> => 0,
  };

  conversation = {
    create: async (args: any): Promise<Conversation> =>
      ({
        id: "mock-conv-id",
        type: args.data.type || "DIRECT_MESSAGE",
        name: args.data.name,
        description: args.data.description,
        isActive: true,
        allowMemberAdd: true,
        allowFileSharing: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        creatorId: args.data.createdById || "mock-creator",
      }) as Conversation,
  findUnique: async (_args: any): Promise<Conversation | null> => null,
  findMany: async (_args: any): Promise<Conversation[]> => [],
  findFirst: async (_args: any): Promise<Conversation | null> => null,
  update: async (_args: any): Promise<Conversation> => ({}) as Conversation,
  delete: async (_args: any): Promise<Conversation> => ({}) as Conversation,
  count: async (_args: any): Promise<number> => 0,
  };

  conversationUser = {
    create: async (args: any): Promise<ConversationUser> =>
      ({
        id: "mock-conv-user-id",
        role: args.data.role || "MEMBER",
        isActive: true,
        isMuted: false,
        joinedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: args.data.userId,
        conversationId: args.data.conversationId,
      }) as ConversationUser,
    createMany: async (args: any): Promise<{ count: number }> => ({
      count: args.data?.length || 0,
    }),
    findUnique: async (_args: any): Promise<ConversationUser | null> => null,
    findFirst: async (_args: any): Promise<ConversationUser | null> => null,
    findMany: async (_args: any): Promise<ConversationUser[]> => [],
    update: async (_args: any): Promise<ConversationUser> =>
      ({}) as ConversationUser,
    delete: async (_args: any): Promise<ConversationUser> =>
      ({}) as ConversationUser,
    count: async (_args: any): Promise<number> => 0,
  };

  message = {
    create: async (args: any): Promise<Message> =>
      ({
        id: "mock-msg-id",
        content: args.data.content,
        type: args.data.type || "TEXT",
        status: "SENT",
        isEdited: false,
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        senderId: args.data.senderId,
        conversationId: args.data.conversationId,
      }) as Message,
  findUnique: async (_args: any): Promise<Message | null> => null,
  findMany: async (_args: any): Promise<Message[]> => [],
  update: async (_args: any): Promise<Message> => ({}) as Message,
  delete: async (_args: any): Promise<Message> => ({}) as Message,
  count: async (_args: any): Promise<number> => 0,
  };

  messageRead = {
    create: async (args: any): Promise<MessageRead> =>
      ({
        id: "mock-read-id",
        readAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: args.data.userId,
        messageId: args.data.messageId,
      }) as MessageRead,
    findUnique: async (_args: any): Promise<MessageRead | null> => null,
    findMany: async (_args: any): Promise<MessageRead[]> => [],
    update: async (_args: any): Promise<MessageRead> => ({}) as MessageRead,
    upsert: async (args: any): Promise<MessageRead> =>
      ({
        id: "mock-read-id",
        readAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: args.create.userId,
        messageId: args.create.messageId,
      }) as MessageRead,
    delete: async (_args: any): Promise<MessageRead> => ({}) as MessageRead,
    count: async (_args: any): Promise<number> => 0,
  };

  attachment = {
    create: async (args: any): Promise<Attachment> =>
      ({
        id: "mock-attachment-id",
        filename: args.data.filename,
        originalName: args.data.originalName,
        mimeType: args.data.mimeType,
        size: args.data.size,
        url: args.data.url,
        type: "OTHER",
        createdAt: new Date(),
        updatedAt: new Date(),
        uploaderId: args.data.uploaderId,
        messageId: args.data.messageId,
      }) as Attachment,
  findUnique: async (_args: any): Promise<Attachment | null> => null,
  findMany: async (_args: any): Promise<Attachment[]> => [],
  update: async (_args: any): Promise<Attachment> => ({}) as Attachment,
  delete: async (_args: any): Promise<Attachment> => ({}) as Attachment,
  count: async (_args: any): Promise<number> => 0,
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

  // Query raw support
  async $queryRaw(_query: any) {
    return Promise.resolve([{ result: 1 }]);
  }
}

export namespace Prisma {
  export interface PostWhereInput {
    id?: string | { lt?: string; gt?: string; in?: string[] };
    authorId?: string | { in?: string[] };
    visibility?: string | { in?: string[] };
    createdAt?: Date | { lt?: Date; gt?: Date; gte?: Date; lte?: Date };
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
    createdAt?: "asc" | "desc";
    updatedAt?: "asc" | "desc";
    viewCount?: "asc" | "desc";
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
    asc: "asc",
    desc: "desc",
  },
  VisibilityType: {
    PUBLIC: "PUBLIC",
    CONNECTIONS_ONLY: "CONNECTIONS_ONLY",
    CLOSE_FRIENDS_ONLY: "CLOSE_FRIENDS_ONLY",
    PRIVATE: "PRIVATE",
  },
  InteractionType: {
    LIKE: "LIKE",
    COMMENT: "COMMENT",
    SHARE: "SHARE",
    VIEW: "VIEW",
  },
  ConnectionStatus: {
    PENDING: "PENDING",
    ACCEPTED: "ACCEPTED",
    REJECTED: "REJECTED",
    BLOCKED: "BLOCKED",
  },
};
