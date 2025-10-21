import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

const DEFAULT_CONVERSATIONS = 100;
const DEFAULT_MESSAGES_PER_CONVERSATION = 50;
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';
const SYSTEM_USER_EMAIL = 'loadtest@local.dev';
const SYSTEM_USERNAME = 'loadtest_user';

function getEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return parsed;
}

const conversationCount = getEnvNumber('CONVERSATION_COUNT', DEFAULT_CONVERSATIONS);
const messagesPerConversation = getEnvNumber('MESSAGES_PER_CONVERSATION', DEFAULT_MESSAGES_PER_CONVERSATION);

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required.');
  process.exit(1);
}

const prisma = new PrismaClient();

function buildConversationBatch(startIndex: number, batchSize: number): Prisma.ConversationCreateManyInput[] {
  const now = new Date();
  const results: Prisma.ConversationCreateManyInput[] = [];
  for (let offset = 0; offset < batchSize; offset += 1) {
    const index = startIndex + offset + 1;
    results.push({
      id: randomUUID(),
      name: `Load Test Conversation ${index}`,
  creatorId: SYSTEM_USER_ID,
      type: 'DIRECT_MESSAGE',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }
  return results;
}

function buildMessagesForConversation(
  conversationId: string,
  startIndex: number,
  count: number,
): Prisma.MessageCreateManyInput[] {
  const data: Prisma.MessageCreateManyInput[] = [];
  const now = Date.now();
  const rangeMs = 7 * 24 * 60 * 60 * 1000;

  for (let idx = 0; idx < count; idx += 1) {
    const messageNumber = startIndex + idx + 1;
    const randomOffset = Math.floor(Math.random() * rangeMs);
    const createdAt = new Date(now - randomOffset);
    data.push({
        id: randomUUID(),
      conversationId,
  senderId: SYSTEM_USER_ID,
      content: `Test message ${messageNumber}`,
      type: 'TEXT',
      status: 'SENT',
      createdAt,
      updatedAt: createdAt,
    });
  }

  return data;
}

async function generateConversations(): Promise<string[]> {
  const createdIds: string[] = [];
  const batchSize = 100;

  for (let start = 0; start < conversationCount; start += batchSize) {
    const batch = buildConversationBatch(start, Math.min(batchSize, conversationCount - start));
  const ids = batch.map((item) => item.id as string);
  createdIds.push(...ids);
    await prisma.conversation.createMany({ data: batch, skipDuplicates: true });
  }

  return createdIds;
}

async function generateMessages(conversationIds: string[]): Promise<number> {
  let created = 0;
  const batchSize = 500;

  for (const conversationId of conversationIds) {
    let createdForConversation = 0;
    while (createdForConversation < messagesPerConversation) {
      const currentBatch = Math.min(batchSize, messagesPerConversation - createdForConversation);
      const data = buildMessagesForConversation(conversationId, createdForConversation, currentBatch);
      await prisma.message.createMany({ data, skipDuplicates: true });
      created += data.length;
      createdForConversation += data.length;
    }
  }

  return created;
}

async function main(): Promise<void> {
  const startTime = Date.now();
  try {
    await prisma.user.upsert({
      where: { id: SYSTEM_USER_ID },
      update: {},
      create: {
        id: SYSTEM_USER_ID,
        email: SYSTEM_USER_EMAIL,
        username: SYSTEM_USERNAME,
        firstName: 'Load',
        lastName: 'Tester',
      },
    });

    console.log(`Generating ${conversationCount} conversations and ${messagesPerConversation} messages each.`);
    const conversationIds = await generateConversations();
    const messageCount = await generateMessages(conversationIds);
    const conversationsCreated = await prisma.conversation.count({
      where: { name: { startsWith: 'Load Test Conversation' } },
    });
    const messagesCreated = await prisma.message.count({
      where: { conversationId: { in: conversationIds } },
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`Created conversations: ${conversationsCreated}`);
    console.log(`Created messages: ${messagesCreated}`);
    console.log(`Total message inserts this run: ${messageCount}`);
    console.log(`Execution time: ${duration}s`);
  } catch (error) {
    console.error('Failed to generate test data:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error('Unhandled error during generation:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
