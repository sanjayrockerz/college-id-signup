#!/usr/bin/env ts-node
/**
 * Heavy Room Generator - Simple Power-Law Dataset for Phase 2 Testing
 * 
 * Creates realistic heavy-tailed distribution with hot paths:
 * - Top 1% of rooms have 15%+ of messages
 * - Power-law alpha 1.8 for realistic skew
 * - Minimal dependencies, fast execution
 * 
 * Usage:
 *   ts-node heavy-room-generator.ts [--users 5000] [--conversations 8000] [--messages 500000]
 */

import { PrismaClient } from "@prisma/client";

interface GeneratorConfig {
  userCount: number;
  conversationCount: number;
  messageCount: number;
  alpha: number; // Power-law exponent (1.8 = strong skew)
}

class HeavyRoomGenerator {
  private prisma: PrismaClient;
  private config: GeneratorConfig;
  private userIds: string[] = [];
  private conversationIds: string[] = [];

  constructor(config: GeneratorConfig) {
    this.prisma = new PrismaClient();
    this.config = config;
  }

  // Power-law distribution sampler (inverse transform method)
  private powerLaw(min: number, max: number, alpha: number): number {
    const u = Math.random();
    const minAlpha = Math.pow(min, 1 - alpha);
    const maxAlpha = Math.pow(max, 1 - alpha);
    return Math.floor(Math.pow(minAlpha + u * (maxAlpha - minAlpha), 1 / (1 - alpha)));
  }

  // Generate synthetic email
  private generateEmail(index: number): string {
    return `syn_user_${index}_${Date.now()}@synthetic.test`;
  }

  // Generate synthetic content
  private generateContent(length: number): string {
    const words = ["hello", "test", "message", "chat", "hey", "ok", "thanks", "sure", "great", "yes", "no"];
    const result: string[] = [];
    while (result.join(" ").length < length) {
      result.push(words[Math.floor(Math.random() * words.length)]);
    }
    return result.join(" ").substring(0, length);
  }

  // Generate random timestamp within last 30 days
  private randomTimestamp(): Date {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const randomTime = thirtyDaysAgo + Math.random() * (now - thirtyDaysAgo);
    return new Date(randomTime);
  }

  async generate(): Promise<void> {
    console.log(`\n=== Heavy Room Generator ===`);
    console.log(`Users: ${this.config.userCount}`);
    console.log(`Conversations: ${this.config.conversationCount}`);
    console.log(`Messages: ${this.config.messageCount}`);
    console.log(`Power-law alpha: ${this.config.alpha}\n`);

    // Clear existing data
    console.log("[Cleanup] Removing existing synthetic data...");
    await this.prisma.message.deleteMany({
      where: { content: { startsWith: "hello" } },
    });
    await this.prisma.conversationUser.deleteMany({});
    await this.prisma.conversation.deleteMany({
      where: { name: { startsWith: "Heavy Room" } },
    });
    await this.prisma.user.deleteMany({
      where: { email: { startsWith: "syn_user_" } },
    });
    console.log("[Cleanup] ✓ Complete\n");

    // Step 1: Generate users
    console.log(`[Step 1/4] Generating ${this.config.userCount} users...`);
    const startUsers = Date.now();
    
    const users = Array.from({ length: this.config.userCount }, (_, i) => ({
      email: this.generateEmail(i),
      username: `synuser${i}`,
      firstName: `User`,
      lastName: `${i}`,
      bio: `Synthetic test user ${i}`,
      isActive: true,
      createdAt: this.randomTimestamp(),
    }));

    // Batch insert users
    const batchSize = 1000;
    for (let i = 0; i < users.length; i += batchSize) {
      const batch = users.slice(i, i + batchSize);
      await this.prisma.user.createMany({ data: batch });
      if ((i + batchSize) % 5000 === 0) {
        console.log(`  Progress: ${i + batchSize}/${this.config.userCount}`);
      }
    }

    // Fetch user IDs
    const userRecords = await this.prisma.user.findMany({
      where: { email: { startsWith: "syn_user_" } },
      select: { id: true },
    });
    this.userIds = userRecords.map((u) => u.id);
    
    const usersTime = ((Date.now() - startUsers) / 1000).toFixed(1);
    console.log(`[Step 1/4] ✓ Complete (${usersTime}s)\n`);

    // Step 2: Generate conversations with power-law distribution
    console.log(`[Step 2/4] Generating ${this.config.conversationCount} conversations...`);
    const startConvos = Date.now();

    // Calculate messages per conversation using power-law
    const messagesPerConvo: number[] = [];
    let totalAllocated = 0;

    // Generate power-law distributed message counts
    for (let i = 0; i < this.config.conversationCount; i++) {
      const msgCount = this.powerLaw(1, 10000, this.config.alpha);
      messagesPerConvo.push(msgCount);
      totalAllocated += msgCount;
    }

    // Normalize to target message count
    const scaleFactor = this.config.messageCount / totalAllocated;
    for (let i = 0; i < messagesPerConvo.length; i++) {
      messagesPerConvo[i] = Math.max(1, Math.floor(messagesPerConvo[i] * scaleFactor));
    }

    // Sort descending to process heavy rooms first
    messagesPerConvo.sort((a, b) => b - a);

    // Calculate stats
    const top1Percent = Math.ceil(this.config.conversationCount * 0.01);
    const top5Percent = Math.ceil(this.config.conversationCount * 0.05);
    const top1Messages = messagesPerConvo.slice(0, top1Percent).reduce((a, b) => a + b, 0);
    const top5Messages = messagesPerConvo.slice(0, top5Percent).reduce((a, b) => a + b, 0);
    const totalMessages = messagesPerConvo.reduce((a, b) => a + b, 0);

    console.log(`  Distribution preview:`);
    console.log(`    Top 1% (${top1Percent} convos): ${((top1Messages / totalMessages) * 100).toFixed(1)}% of messages`);
    console.log(`    Top 5% (${top5Percent} convos): ${((top5Messages / totalMessages) * 100).toFixed(1)}% of messages`);
    console.log(`    p50: ${messagesPerConvo[Math.floor(messagesPerConvo.length / 2)]}`);
    console.log(`    p95: ${messagesPerConvo[Math.floor(messagesPerConvo.length * 0.05)]}`);
    console.log(`    p99: ${messagesPerConvo[Math.floor(messagesPerConvo.length * 0.01)]}`);
    console.log(`    max: ${messagesPerConvo[0]}\n`);

    // Create conversations
    const conversations = messagesPerConvo.map((msgCount, i) => {
      const isDM = Math.random() < 0.7;
      const creatorId = this.userIds[Math.floor(Math.random() * this.userIds.length)];
      
      return {
        name: `Heavy Room ${i}`,
        type: (isDM ? "DIRECT_MESSAGE" : "GROUP_CHAT") as "DIRECT_MESSAGE" | "GROUP_CHAT" | "CHANNEL",
        creatorId,
        createdAt: this.randomTimestamp(),
      };
    });

    // Batch insert conversations
    for (let i = 0; i < conversations.length; i += batchSize) {
      const batch = conversations.slice(i, i + batchSize);
      await this.prisma.conversation.createMany({ data: batch });
      if ((i + batchSize) % 2000 === 0) {
        console.log(`  Progress: ${i + batchSize}/${this.config.conversationCount}`);
      }
    }

    // Fetch conversation IDs
    const convoRecords = await this.prisma.conversation.findMany({
      where: { name: { startsWith: "Heavy Room" } },
      select: { id: true },
      orderBy: { createdAt: "desc" }, // Should roughly match our sorted order
    });
    this.conversationIds = convoRecords.map((c) => c.id);

    const convosTime = ((Date.now() - startConvos) / 1000).toFixed(1);
    console.log(`[Step 2/4] ✓ Complete (${convosTime}s)\n`);

    // Step 3: Add conversation participants
    console.log(`[Step 3/4] Adding conversation participants...`);
    const startParticipants = Date.now();

    const participants: Array<{ conversationId: string; userId: string; joinedAt: Date }> = [];
    
    for (let i = 0; i < this.conversationIds.length; i++) {
      const convoId = this.conversationIds[i];
      const convo = conversations[i];
      
      // Add creator
      participants.push({
        conversationId: convoId,
        userId: convo.creatorId,
        joinedAt: convo.createdAt,
      });

      // Add 1-3 more participants for DMs, 2-10 for groups
      const participantCount = convo.type === "DIRECT_MESSAGE" ? 1 : Math.floor(Math.random() * 9) + 2;
      
      for (let j = 0; j < participantCount; j++) {
        const userId = this.userIds[Math.floor(Math.random() * this.userIds.length)];
        if (userId !== convo.creatorId) {
          participants.push({
            conversationId: convoId,
            userId,
            joinedAt: new Date(convo.createdAt.getTime() + Math.random() * 1000 * 60 * 60),
          });
        }
      }

      if ((i + 1) % 2000 === 0) {
        console.log(`  Progress: ${i + 1}/${this.conversationIds.length}`);
      }
    }

    // Batch insert participants
    for (let i = 0; i < participants.length; i += batchSize * 5) {
      const batch = participants.slice(i, i + batchSize * 5);
      await this.prisma.conversationUser.createMany({ 
        data: batch,
        skipDuplicates: true,
      });
    }

    const participantsTime = ((Date.now() - startParticipants) / 1000).toFixed(1);
    console.log(`[Step 3/4] ✓ Complete (${participantsTime}s)\n`);

    // Step 4: Generate messages with power-law distribution
    console.log(`[Step 4/4] Generating messages...`);
    const startMessages = Date.now();

    let messagesGenerated = 0;
    const messageBatch: any[] = [];
    const insertBatchSize = 5000;

    for (let i = 0; i < this.conversationIds.length; i++) {
      const convoId = this.conversationIds[i];
      const msgCount = messagesPerConvo[i];
      const convo = conversations[i];

      // Get participants for this conversation
      const convoParticipants = participants
        .filter((p) => p.conversationId === convoId)
        .map((p) => p.userId);

      if (convoParticipants.length === 0) continue;

      const baseTime = convo.createdAt.getTime();

      for (let j = 0; j < msgCount; j++) {
        const senderId = convoParticipants[Math.floor(Math.random() * convoParticipants.length)];
        const messageType = Math.random() < 0.83 ? "TEXT" : Math.random() < 0.76 ? "IMAGE" : "FILE";
        const contentLength = Math.floor(20 + Math.random() * 180);

        messageBatch.push({
          conversationId: convoId,
          senderId,
          content: this.generateContent(contentLength),
          type: messageType,
          createdAt: new Date(baseTime + j * 1000 * 60 + Math.random() * 1000 * 60),
        });

        messagesGenerated++;

        // Insert in batches
        if (messageBatch.length >= insertBatchSize) {
          await this.prisma.message.createMany({ data: messageBatch });
          messageBatch.length = 0; // Clear array

          if (messagesGenerated % 50000 === 0) {
            const progress = ((messagesGenerated / totalMessages) * 100).toFixed(1);
            const elapsed = ((Date.now() - startMessages) / 1000).toFixed(0);
            const rate = Math.floor(messagesGenerated / (Date.now() - startMessages) * 1000);
            console.log(`  Progress: ${messagesGenerated.toLocaleString()}/${totalMessages.toLocaleString()} (${progress}%) - ${rate} msg/s - ${elapsed}s elapsed`);
          }
        }
      }
    }

    // Insert remaining messages
    if (messageBatch.length > 0) {
      await this.prisma.message.createMany({ data: messageBatch });
    }

    const messagesTime = ((Date.now() - startMessages) / 1000).toFixed(1);
    console.log(`[Step 4/4] ✓ Complete (${messagesTime}s)\n`);

    // Summary
    const totalTime = ((Date.now() - startUsers) / 1000 / 60).toFixed(1);
    console.log(`\n=== Generation Complete ===`);
    console.log(`Total time: ${totalTime} minutes`);
    console.log(`Users: ${this.userIds.length}`);
    console.log(`Conversations: ${this.conversationIds.length}`);
    console.log(`Messages: ${messagesGenerated.toLocaleString()}`);
    console.log(`\nRun validation:`);
    console.log(`  cd scripts/synthetic-data`);
    console.log(`  npx ts-node validate-dataset-quality.ts\n`);
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);
  
  const config: GeneratorConfig = {
    userCount: 5000,
    conversationCount: 8000,
    messageCount: 500000,
    alpha: 1.8,
  };

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--users" && args[i + 1]) {
      config.userCount = parseInt(args[i + 1], 10);
    } else if (args[i] === "--conversations" && args[i + 1]) {
      config.conversationCount = parseInt(args[i + 1], 10);
    } else if (args[i] === "--messages" && args[i + 1]) {
      config.messageCount = parseInt(args[i + 1], 10);
    } else if (args[i] === "--alpha" && args[i + 1]) {
      config.alpha = parseFloat(args[i + 1]);
    }
  }

  const generator = new HeavyRoomGenerator(config);

  try {
    await generator.generate();
  } catch (error) {
    console.error("\n[FATAL ERROR]", error);
    process.exit(1);
  } finally {
    await generator.cleanup();
  }
}

if (require.main === module) {
  main();
}
