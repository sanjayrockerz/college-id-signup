/**
 * Example usage of the Database Singleton
 * This file shows how to use the singleton database client in your application
 */

// Import the singleton client
import { prisma, connectDatabase, disconnectDatabase, executeTransaction } from '../config/database';

/**
 * Example 1: Basic usage with the singleton
 */
export async function getUserExample(userId: string) {
  // Use the singleton client directly
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      posts: true,
      connections: true,
    },
  });
  
  return user;
}

/**
 * Example 2: Using transactions
 */
export async function createUserWithProfileExample(userData: any) {
  return await executeTransaction(async (tx) => {
    // Create user
    const user = await tx.user.create({
      data: {
        email: userData.email,
        username: userData.username,
        firstName: userData.firstName,
        lastName: userData.lastName,
      },
    });

    // Create initial post
    await tx.post.create({
      data: {
        content: `Welcome ${userData.firstName}! 👋`,
        authorId: user.id,
        visibility: 'PUBLIC',
      },
    });

    return user;
  });
}

/**
 * Example 3: Chat-related operations
 */
export async function getOrCreateDirectConversation(userId1: string, userId2: string) {
  // Check if conversation already exists
  let conversation = await prisma.conversation.findFirst({
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

  // If no conversation exists, create one
  if (!conversation) {
    conversation = await executeTransaction(async (tx) => {
      const newConversation = await tx.conversation.create({
        data: {
          type: 'DIRECT_MESSAGE',
          creatorId: userId1,
          conversationUsers: {
            create: [
              { userId: userId1, role: 'MEMBER' },
              { userId: userId2, role: 'MEMBER' },
            ],
          },
        },
        include: {
          conversationUsers: {
            where: { isActive: true },
            include: { user: true },
          },
        },
      });

      return newConversation;
    });
  }

  return conversation;
}

/**
 * Example 4: Sending a message in a conversation
 */
export async function sendMessage(senderId: string, conversationId: string, content: string) {
  return await executeTransaction(async (tx) => {
    // Create the message
    const message = await tx.message.create({
      data: {
        content,
        senderId,
        conversationId,
        type: 'TEXT',
      },
      include: {
        sender: {
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

    // Update conversation's last message info
    await tx.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: new Date(),
        lastMessageId: message.id,
        updatedAt: new Date(),
      },
    });

    return message;
  });
}

/**
 * Example 5: Application initialization
 */
export async function initializeApplication() {
  try {
    // Connect to database
    await connectDatabase();
    console.log('✅ Application database initialized');

    // Run any migrations or setup tasks here
    // await runMigrations();
    // await seedDatabase();

    return true;
  } catch (error) {
    console.error('❌ Failed to initialize application:', error);
    throw error;
  }
}

/**
 * Example 6: Application shutdown
 */
export async function shutdownApplication() {
  try {
    // Perform cleanup tasks
    console.log('🔄 Shutting down application...');
    
    // Disconnect from database
    await disconnectDatabase();
    console.log('✅ Application shutdown complete');
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    throw error;
  }
}

/**
 * Example 7: Health check endpoint
 */
export async function healthCheckEndpoint() {
  try {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const latency = Date.now() - start;

    return {
      status: 'healthy',
      database: 'connected',
      latency: `${latency}ms`,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      database: 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Example 8: Complex query with joins
 */
export async function getUserFeedExample(userId: string, limit = 20) {
  return await prisma.post.findMany({
    where: {
      OR: [
        // User's own posts
        { authorId: userId },
        // Posts from connected users
        {
          author: {
            sentConnections: {
              some: {
                receiverId: userId,
                status: 'ACCEPTED',
              },
            },
          },
        },
        {
          author: {
            receivedConnections: {
              some: {
                requesterId: userId,
                status: 'ACCEPTED',
              },
            },
          },
        },
      ],
      visibility: {
        in: ['PUBLIC', 'CONNECTIONS_ONLY'],
      },
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
      interactions: {
        where: { userId },
        select: { type: true },
      },
      _count: {
        select: {
          interactions: true,
          coolnessRatings: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
