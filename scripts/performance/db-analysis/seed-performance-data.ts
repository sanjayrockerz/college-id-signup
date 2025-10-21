import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

interface ConversationSeedConfig {
  id: string;
  name: string;
  creatorId: string;
  daysOfHistory: number;
  targetMessageCount: number;
  dailyMessageVariance: number;
}

interface SeedUserConfig {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
}

const prisma = new PrismaClient();

const USERS: SeedUserConfig[] = [
  {
    id: '5b12e375-59a5-4e65-a2d2-3a4edc0d2b5c',
    email: 'analysis_user1@perf.local',
    username: 'analysis_user1',
    firstName: 'Perf',
    lastName: 'Analyst',
  },
  {
    id: '7d8a2a5a-64ef-4f25-b4ee-5448f2f3540f',
    email: 'analysis_user2@perf.local',
    username: 'analysis_user2',
    firstName: 'Load',
    lastName: 'Tester',
  },
  {
    id: '8a16e3fe-8672-4cc9-8c03-cb1654587b62',
    email: 'analysis_user3@perf.local',
    username: 'analysis_user3',
    firstName: 'Scale',
    lastName: 'Captain',
  },
];

const CONVERSATIONS: ConversationSeedConfig[] = [
  {
    id: '8f7a0c83-dad5-4f02-92a9-55078fef9f31',
    name: 'Primary Perf Thread',
    creatorId: USERS[0].id,
    daysOfHistory: 30,
    targetMessageCount: 1500,
    dailyMessageVariance: 0.15,
  },
  {
    id: '86b4f1b6-3ad8-4828-90f8-49cba3c8cb20',
    name: 'Perf Thread 2',
    creatorId: USERS[1].id,
    daysOfHistory: 14,
    targetMessageCount: 900,
    dailyMessageVariance: 0.25,
  },
  {
    id: 'f3cd5f34-db29-4ceb-9993-578920cb51f2',
    name: 'Perf Thread 3',
    creatorId: USERS[2].id,
    daysOfHistory: 7,
    targetMessageCount: 600,
    dailyMessageVariance: 0.35,
  },
];

const MESSAGE_BATCH_SIZE = 100;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildMessagePayload(
  conversationId: string,
  senderId: string,
  content: string,
  createdAt: Date,
): Prisma.MessageCreateManyInput {
  return {
    id: randomUUID(),
    conversationId,
    senderId,
    content,
    type: 'TEXT',
    status: 'SENT',
    createdAt,
    updatedAt: createdAt,
  };
}

function pickSender(sequence: number): string {
  return USERS[sequence % USERS.length].id;
}

function generateDailyMessageTargets(config: ConversationSeedConfig): number[] {
  const basePerDay = config.targetMessageCount / config.daysOfHistory;
  const targets: number[] = [];

  for (let day = config.daysOfHistory - 1; day >= 0; day -= 1) {
    const variance = (Math.random() * 2 - 1) * config.dailyMessageVariance;
    const dailyCount = clamp(Math.round(basePerDay * (1 + variance)), 10, MESSAGE_BATCH_SIZE * 2);
    targets.push(dailyCount);
  }

  return targets;
}

async function ensureUsers(): Promise<void> {
  for (const user of USERS) {
    await prisma.user.upsert({
      where: { id: user.id },
      update: {
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      create: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    });
  }
}

async function ensureConversations(): Promise<void> {
  const now = new Date();
  for (const conversation of CONVERSATIONS) {
    const createdAt = new Date(now.getTime() - conversation.daysOfHistory * 24 * 60 * 60 * 1000);

    await prisma.conversation.upsert({
      where: { id: conversation.id },
      update: {
        name: conversation.name,
        updatedAt: now,
      },
      create: {
        id: conversation.id,
        name: conversation.name,
        creatorId: conversation.creatorId,
        type: 'DIRECT_MESSAGE',
        isActive: true,
        createdAt,
        updatedAt: now,
      },
    });

    for (const user of USERS) {
      await prisma.conversationUser.upsert({
        where: {
          userId_conversationId: {
            userId: user.id,
            conversationId: conversation.id,
          },
        },
        update: {
          isActive: true,
        },
        create: {
          id: `${conversation.id.replace(/-/g, '').slice(0, 20)}-${user.id.slice(0, 8)}-${conversation.id.slice(-4)}`,
          userId: user.id,
          conversationId: conversation.id,
          role: user.id === conversation.creatorId ? 'OWNER' : 'MEMBER',
          isActive: true,
          joinedAt: createdAt,
        },
      });
    }
  }
}

async function seedMessages(): Promise<void> {
  for (const conversation of CONVERSATIONS) {
    await prisma.message.deleteMany({ where: { conversationId: conversation.id } });

    const targets = generateDailyMessageTargets(conversation);
    const dailyWindowMs = 24 * 60 * 60 * 1000;
    const baseStart = Date.now() - conversation.daysOfHistory * dailyWindowMs;
    let messageCounter = 0;

    for (let dayIndex = 0; dayIndex < targets.length; dayIndex += 1) {
      const messagesToday = targets[dayIndex];
      const dayStart = baseStart + dayIndex * dailyWindowMs;
      const gapMs = Math.floor(dailyWindowMs / Math.max(messagesToday, 1));
      const batch: Prisma.MessageCreateManyInput[] = [];

      for (let i = 0; i < messagesToday; i += 1) {
        const sequence = messageCounter + i;
        const createdAt = new Date(dayStart + i * gapMs + Math.floor(Math.random() * Math.max(gapMs - 1, 1)));
        const senderId = pickSender(sequence);
        const content = `Seeded perf message ${sequence + 1} in conversation ${conversation.id}`;
        batch.push(buildMessagePayload(conversation.id, senderId, content, createdAt));

        if (batch.length === MESSAGE_BATCH_SIZE) {
          await prisma.message.createMany({ data: batch });
          batch.length = 0;
        }
      }

      if (batch.length > 0) {
        await prisma.message.createMany({ data: batch });
      }

      messageCounter += messagesToday;
    }
  }
}

async function seedReads(): Promise<void> {
  for (const conversation of CONVERSATIONS) {
    const latestMessages = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, createdAt: true },
    });

    for (const user of USERS) {
      const subset = latestMessages.filter((_, index) => index % USERS.length === USERS.indexOf(user));
      for (const message of subset) {
        await prisma.messageRead.upsert({
          where: { userId_messageId: { userId: user.id, messageId: message.id } },
          update: { readAt: message.createdAt },
          create: {
            userId: user.id,
            messageId: message.id,
            readAt: message.createdAt,
          },
        });
      }
    }
  }
}

async function main(): Promise<void> {
  try {
    await ensureUsers();
    await ensureConversations();
    await seedMessages();
    await seedReads();

    const aggregates = await Promise.all(
      CONVERSATIONS.map(async (conversation) => {
        const [messageCount, readCount] = await Promise.all([
          prisma.message.count({ where: { conversationId: conversation.id } }),
          prisma.messageRead.count({ where: { message: { conversationId: conversation.id } } }),
        ]);
        return {
          conversationId: conversation.id,
          messageCount,
          readCount,
        };
      }),
    );

    console.log({ conversations: aggregates });
  } catch (error) {
    console.error('Performance dataset seed failed:', error);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error('Unhandled seed error:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
