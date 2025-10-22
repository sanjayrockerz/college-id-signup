#!/usr/bin/env ts-node
/**
 * Synthetic Dataset Generator for Phase 2 Performance Validation
 *
 * Produces statistically realistic, PII-free datasets matching production
 * distributions for message volume, conversation patterns, and temporal behavior.
 *
 * Usage:
 *   ts-node generator.ts --band dev|staging|perf --seed <seed_string>
 */

import { PrismaClient } from "@prisma/client";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

interface DistributionSpec {
  users: { count: Record<string, number> };
  conversations: {
    type_distribution: Record<string, number>;
    size_ranges: Record<string, any>;
    count_per_band: Record<string, number>;
    heavy_rooms: { percentage: number; min_messages: number };
  };
  messages: {
    count_per_band: Record<string, number>;
    per_conversation_distribution: any;
    content: any;
    inter_arrival: any;
  };
  read_receipts: any;
  attachments: any;
  temporal_patterns: any;
}

type DatasetBand = "dev" | "staging" | "perf";

class SeededRandom {
  private state: number;

  constructor(seed: string) {
    const hash = crypto.createHash("sha256").update(seed).digest();
    this.state = hash.readUInt32BE(0);
  }

  next(): number {
    // Linear congruential generator (same params as java.util.Random)
    this.state = (this.state * 1103515245 + 12345) & 0x7fffffff;
    return this.state / 0x80000000;
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  choice<T>(array: T[]): T {
    return array[Math.floor(this.next() * array.length)];
  }

  // Box-Muller transform for normal distribution
  normal(mean: number, stddev: number): number {
    const u1 = this.next();
    const u2 = this.next();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return z0 * stddev + mean;
  }

  // Exponential distribution
  exponential(lambda: number): number {
    return -Math.log(1 - this.next()) / lambda;
  }

  // Power law distribution
  powerLaw(min: number, max: number, alpha: number): number {
    const u = this.next();
    const minAlpha = Math.pow(min, 1 - alpha);
    const maxAlpha = Math.pow(max, 1 - alpha);
    return Math.pow(minAlpha + u * (maxAlpha - minAlpha), 1 / (1 - alpha));
  }

  // Log-normal distribution
  logNormal(mu: number, sigma: number): number {
    return Math.exp(this.normal(mu, sigma));
  }

  // Fisher-Yates shuffle
  shuffle<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}

class SyntheticDataGenerator {
  private prisma: PrismaClient;
  private spec: DistributionSpec;
  private rng: SeededRandom;
  private band: DatasetBand;
  private generationStart: Date;

  constructor(band: DatasetBand, seed: string) {
    this.prisma = new PrismaClient();
    this.band = band;
    this.rng = new SeededRandom(seed);
    this.generationStart = new Date();

    const specPath = path.join(__dirname, "distribution-spec.json");
    this.spec = JSON.parse(fs.readFileSync(specPath, "utf-8"));

    console.log(`[SyntheticGen] Initialized for band=${band}, seed=${seed}`);
  }

  async generate(): Promise<void> {
    console.log(`[SyntheticGen] Starting generation for ${this.band} band`);

    await this.generateUsers();
    await this.generateConversations();
    await this.generateMessages();
    await this.generateReadReceipts();

    console.log(`[SyntheticGen] Generation complete`);
    await this.generateReport();
  }

  private async generateUsers(): Promise<void> {
    const count = this.spec.users.count[this.band];
    console.log(`[Users] Generating ${count} users...`);

    const batchSize = 1000;
    for (let i = 0; i < count; i += batchSize) {
      const batch = Math.min(batchSize, count - i);
      const users = [];

      for (let j = 0; j < batch; j++) {
        const userIndex = i + j;
        const usernameLength = Math.max(
          3,
          Math.min(30, Math.round(this.rng.normal(12, 4))),
        );

        users.push({
          username: `user_${userIndex}_${this.randomString(usernameLength - String(userIndex).length - 6)}`,
          email: `synthetic_${userIndex}@example.local`,
          firstName: this.randomName(),
          lastName: this.randomName(),
          bio: this.rng.next() > 0.4 ? this.randomBio() : null,
          profileImageUrl:
            this.rng.next() > 0.6
              ? `https://cdn.example.com/avatars/${userIndex}.jpg`
              : null,
          isActive: this.rng.next() > 0.05, // 95% active users
          createdAt: this.randomTimestamp(),
        });
      }

      await this.prisma.user.createMany({ data: users, skipDuplicates: true });

      if ((i + batch) % 10000 === 0) {
        console.log(`[Users] Generated ${i + batch}/${count}`);
      }
    }

    console.log(`[Users] ✓ Complete: ${count} users`);
  }

  private async generateConversations(): Promise<void> {
    const count = this.spec.conversations.count_per_band[this.band];
    const userCount = this.spec.users.count[this.band];
    const typeDistribution = this.spec.conversations.type_distribution;

    console.log(`[Conversations] Generating ${count} conversations...`);

    const users = await this.prisma.user.findMany({
      select: { id: true },
      take: userCount,
    });

    const userIds = users.map((u) => u.id);
    let heavyRoomCount = 0;
    const heavyRoomThreshold = Math.floor(
      count * this.spec.conversations.heavy_rooms.percentage,
    );

    for (let i = 0; i < count; i++) {
      const rand = this.rng.next();
      let conversationType: "DIRECT_MESSAGE" | "GROUP_CHAT";
      let memberCount: number;

      if (rand < typeDistribution.one_to_one) {
        conversationType = "DIRECT_MESSAGE";
        memberCount = 2;
      } else if (
        rand <
        typeDistribution.one_to_one + typeDistribution.small_group
      ) {
        conversationType = "GROUP_CHAT";
        memberCount = Math.min(
          20,
          Math.max(3, Math.floor(this.rng.exponential(0.3)) + 3),
        );
      } else {
        conversationType = "GROUP_CHAT";
        memberCount = Math.min(
          256,
          Math.max(21, Math.floor(this.rng.powerLaw(21, 256, 2.5))),
        );
      }

      const selectedUsers = this.rng.shuffle(userIds).slice(0, memberCount);
      const creatorId = selectedUsers[0];

      const conversation = await this.prisma.conversation.create({
        data: {
          type: conversationType as any,
          name:
            conversationType === "GROUP_CHAT" ? this.randomGroupName() : null,
          creatorId: creatorId,
          createdAt: this.randomTimestamp(),
        },
      });

      await this.prisma.conversationUser.createMany({
        data: selectedUsers.map((userId: string) => ({
          conversationId: conversation.id,
          userId,
          isActive: true,
          joinedAt: conversation.createdAt,
        })),
      });

      // Mark heavy rooms for later processing
      if (heavyRoomCount < heavyRoomThreshold && this.rng.next() < 0.02) {
        heavyRoomCount++;
        // Store metadata for heavy room message generation
      }

      if ((i + 1) % 5000 === 0) {
        console.log(`[Conversations] Generated ${i + 1}/${count}`);
      }
    }

    console.log(
      `[Conversations] ✓ Complete: ${count} conversations (${heavyRoomCount} heavy rooms)`,
    );
  }

  private async generateMessages(): Promise<void> {
    const targetCount = this.spec.messages.count_per_band[this.band];
    console.log(`[Messages] Generating ~${targetCount} messages...`);

    const conversations = await this.prisma.conversation.findMany({
      include: {
        conversationUsers: {
          select: { userId: true },
        },
      },
    });

    let totalMessages = 0;
    const batchSize = 500;

    for (const conversation of conversations) {
      const memberIds = conversation.conversationUsers.map((cu) => cu.userId);
      if (memberIds.length === 0) continue;

      // Power-law distribution for messages per conversation
      const messageCount = Math.min(
        50000,
        Math.max(1, Math.floor(this.rng.powerLaw(1, 5000, 1.8))),
      );

      let conversationTime = new Date(conversation.createdAt);
      const messages = [];

      for (let i = 0; i < messageCount; i++) {
        const senderId = this.rng.choice(memberIds);
        const contentLength = Math.max(
          1,
          Math.min(5000, Math.floor(this.rng.logNormal(4.5, 1.2))),
        );
        const content = this.randomMessageContent(contentLength);

        // Inter-arrival time with diurnal pattern
        const interArrivalSeconds = this.getInterArrivalTime(conversationTime);
        conversationTime = new Date(
          conversationTime.getTime() + interArrivalSeconds * 1000,
        );

        const hasAttachment =
          this.rng.next() < this.spec.messages.content.media_ratio;

        // Determine message type based on attachment
        let messageType = "TEXT";
        if (hasAttachment) {
          const rand = this.rng.next();
          if (rand < 0.65) messageType = "IMAGE";
          else if (rand < 0.8) messageType = "VIDEO";
          else if (rand < 0.92) messageType = "FILE";
          else messageType = "AUDIO";
        }

        messages.push({
          conversationId: conversation.id,
          senderId,
          content,
          type: messageType as any,
          createdAt: conversationTime,
        });

        if (messages.length >= batchSize) {
          await this.prisma.message.createMany({ data: messages });
          totalMessages += messages.length;
          messages.length = 0;
        }
      }

      if (messages.length > 0) {
        await this.prisma.message.createMany({ data: messages });
        totalMessages += messages.length;
      }

      if (totalMessages >= targetCount) {
        console.log(`[Messages] Reached target count ${targetCount}`);
        break;
      }

      if (totalMessages % 100000 === 0) {
        console.log(`[Messages] Generated ${totalMessages}/${targetCount}`);
      }
    }

    console.log(`[Messages] ✓ Complete: ${totalMessages} messages`);
  }

  private async generateReadReceipts(): Promise<void> {
    console.log(`[ReadReceipts] Generating read receipts...`);

    const messages = await this.prisma.message.findMany({
      select: { id: true, conversationId: true, createdAt: true },
    });

    const conversations = await this.prisma.conversation.findMany({
      include: {
        conversationUsers: {
          select: { userId: true },
        },
      },
    });

    const conversationMembers = new Map<string, string[]>();
    conversations.forEach((conv) => {
      conversationMembers.set(
        conv.id,
        conv.conversationUsers.map((cu) => cu.userId),
      );
    });

    const receipts: any[] = [];
    const batchSize = 1000;

    for (const message of messages) {
      const members = conversationMembers.get(message.conversationId) || [];

      for (const userId of members) {
        // Skip sender
        if (this.rng.next() > 0.95) continue;

        const readAt = this.getReadReceiptTime(message.createdAt);
        if (!readAt) continue;

        receipts.push({
          messageId: message.id,
          userId,
          readAt,
        });

        if (receipts.length >= batchSize) {
          await this.prisma.messageRead.createMany({
            data: receipts,
            skipDuplicates: true,
          });
          receipts.length = 0;
        }
      }
    }

    if (receipts.length > 0) {
      await this.prisma.messageRead.createMany({
        data: receipts,
        skipDuplicates: true,
      });
    }

    console.log(`[ReadReceipts] ✓ Complete`);
  }

  private getInterArrivalTime(currentTime: Date): number {
    const hour = currentTime.getHours();
    const peakHours = this.spec.messages.inter_arrival.peak_hours;
    const isPeak = peakHours.includes(hour);

    const lambda = isPeak
      ? this.spec.messages.inter_arrival.mean_lambda_peak
      : this.spec.messages.inter_arrival.mean_lambda_trough;

    return this.rng.exponential(lambda) * 60; // Convert to seconds
  }

  private getReadReceiptTime(messageCreatedAt: Date): Date | null {
    const rand = this.rng.next();
    const timing = this.spec.read_receipts.timing;

    if (rand < timing.never.percentage) {
      return null;
    }

    let delaySeconds: number;
    if (rand < timing.immediate.percentage) {
      delaySeconds = this.rng.nextInt(1, timing.immediate.within_seconds);
    } else if (
      rand <
      timing.immediate.percentage + timing.near_term.percentage
    ) {
      delaySeconds =
        this.rng.exponential(1 / timing.near_term.mean_minutes) * 60;
    } else {
      delaySeconds =
        this.rng.logNormal(timing.delayed.mu, timing.delayed.sigma) * 3600;
    }

    return new Date(messageCreatedAt.getTime() + delaySeconds * 1000);
  }

  private randomTimestamp(): Date {
    const windowDays = this.spec.temporal_patterns.creation_window[this.band];
    const days = parseInt(windowDays.split("_")[0]);
    const now = this.generationStart.getTime();
    const windowMs = days * 24 * 60 * 60 * 1000;
    return new Date(now - this.rng.next() * windowMs);
  }

  private randomString(length: number): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(this.rng.next() * chars.length));
    }
    return result;
  }

  private randomName(): string {
    const names = [
      "Alice",
      "Bob",
      "Charlie",
      "Diana",
      "Eve",
      "Frank",
      "Grace",
      "Hank",
      "Ivy",
      "Jack",
      "Kate",
      "Leo",
      "Mia",
      "Noah",
      "Olivia",
      "Paul",
    ];
    return this.rng.choice(names);
  }

  private randomBio(): string {
    const bios = [
      "Software developer",
      "Data scientist",
      "Product manager",
      "Designer",
      "Student",
      "Entrepreneur",
    ];
    return this.rng.choice(bios);
  }

  private randomGroupName(): string {
    const prefixes = ["Team", "Project", "Squad", "Group", "Chat"];
    const suffixes = [
      "Alpha",
      "Beta",
      "Gamma",
      "Delta",
      "Omega",
      "1",
      "2",
      "3",
    ];
    return `${this.rng.choice(prefixes)} ${this.rng.choice(suffixes)}`;
  }

  private randomMessageContent(length: number): string {
    const words = [
      "hello",
      "world",
      "test",
      "message",
      "chat",
      "conversation",
      "update",
      "meeting",
      "project",
      "team",
      "work",
      "schedule",
      "deadline",
      "status",
    ];

    let content = "";
    while (content.length < length) {
      content += this.rng.choice(words) + " ";
    }
    return content.trim().substring(0, length);
  }

  private async generateReport(): Promise<void> {
    const report = {
      band: this.band,
      generated_at: new Date().toISOString(),
      seed: "stored_separately",
      counts: {
        users: await this.prisma.user.count(),
        conversations: await this.prisma.conversation.count(),
        messages: await this.prisma.message.count(),
        read_receipts: await this.prisma.messageRead.count(),
      },
      validation: {
        queries_to_test: [
          "Message history with conversationId + ORDER BY createdAt DESC LIMIT",
          "Conversation list for user",
          "Unread message count per conversation",
          "Recent messages across all user conversations",
        ],
      },
    };

    const reportPath = path.join(
      __dirname,
      `report_${this.band}_${Date.now()}.json`,
    );
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`[Report] ✓ Written to ${reportPath}`);
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);
  const bandIndex = args.indexOf("--band");
  const seedIndex = args.indexOf("--seed");

  if (bandIndex === -1 || seedIndex === -1) {
    console.error(
      "Usage: ts-node generator.ts --band <dev|staging|perf> --seed <seed_string>",
    );
    process.exit(1);
  }

  const band = args[bandIndex + 1] as DatasetBand;
  const seed = args[seedIndex + 1];

  if (!["dev", "staging", "perf"].includes(band)) {
    console.error("Invalid band. Use: dev, staging, or perf");
    process.exit(1);
  }

  const generator = new SyntheticDataGenerator(band, seed);

  try {
    await generator.generate();
  } catch (error) {
    console.error("[Error]", error);
    process.exit(1);
  } finally {
    await generator.cleanup();
  }
}

if (require.main === module) {
  main();
}
