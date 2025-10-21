#!/usr/bin/env ts-node
/**
 * Safe cleanup utility for load-test data.
 *
 * Usage:
 *   DATABASE_URL=... npx ts-node scripts/performance/setup/cleanup-test-data.ts --confirm
 */

import { PrismaClient } from '@prisma/client';
import readline from 'readline';

const DATABASE_URL = process.env.DATABASE_URL || '';

if (!DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required.');
  process.exit(1);
}

if (DATABASE_URL.toLowerCase().includes('production')) {
  console.error('Refusing to run cleanup on a database URL containing "production".');
  process.exit(1);
}

if (!process.argv.includes('--confirm')) {
  console.error('Cleanup requires the --confirm flag to proceed.');
  process.exit(1);
}

const prisma = new PrismaClient();

function askQuestion(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main(): Promise<void> {
  const start = Date.now();
  try {
    const conversations = await prisma.conversation.findMany({
      where: { name: { startsWith: 'Load Test' } },
      select: { id: true, name: true },
    });

    if (conversations.length === 0) {
      console.log('No load-test conversations detected. Nothing to delete.');
      return;
    }

    const conversationIds = conversations.map((item) => item.id);
    const messageCount = await prisma.message.count({ where: { conversationId: { in: conversationIds } } });

    console.log(`Preview: ${conversations.length} conversations, ${messageCount} messages will be removed.`);
    const answer = await askQuestion('Delete these records? (Y/n): ');
    if (!/^y(es)?$/i.test(answer || '')) {
      console.log('Aborted by user. No changes made.');
      return;
    }

    const deletedMessages = await prisma.message.deleteMany({ where: { conversationId: { in: conversationIds } } });
    const deletedConversations = await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });

    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`Deleted messages: ${deletedMessages.count}`);
    console.log(`Deleted conversations: ${deletedConversations.count}`);
    console.log(`Cleanup completed in ${duration}s.`);
  } catch (error) {
    console.error('Cleanup failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error('Unhandled cleanup error:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
