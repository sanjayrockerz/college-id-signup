#!/usr/bin/env ts-node
/**
 * SIMPLIFIED Synthetic Dataset Generator
 * Optimized for speed - generates dev dataset in ~10 minutes
 */

import { PrismaClient } from "@prisma/client";
import * as crypto from "crypto";

const prisma = new PrismaClient();

class QuickRNG {
  private state: number;
  constructor(seed: string) {
    const hash = crypto.createHash("sha256").update(seed).digest();
    this.state = hash.readUInt32BE(0);
  }
  next(): number {
    this.state = (this.state * 1103515245 + 12345) & 0x7fffffff;
    return this.state / 0x80000000;
  }
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  choice<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

async function quickGenerate() {
  console.log("[QuickGen] Starting fast generation...");

  const rng = new QuickRNG("dev_quick_20251022");
  const names = [
    "Alice",
    "Bob",
    "Charlie",
    "Diana",
    "Eve",
    "Frank",
    "Grace",
    "Hank",
  ];
  const words = [
    "hello",
    "world",
    "test",
    "message",
    "chat",
    "team",
    "project",
    "update",
  ];

  // 1. Generate 5000 users in bulk
  console.log("[Users] Generating 5000 users...");
  const userBatch = [];
  for (let i = 0; i < 5000; i++) {
    userBatch.push({
      username: `user_${i}_${Date.now().toString(36)}`,
      email: `syn_${i}@example.local`,
      firstName: rng.choice(names),
      lastName: rng.choice(names),
      bio: rng.next() > 0.5 ? "Test bio" : null,
      isActive: true,
    });
  }
  await prisma.user.createMany({ data: userBatch, skipDuplicates: true });
  console.log("[Users] ✓ Created 5000 users");

  // 2. Get user IDs
  const users = await prisma.user.findMany({
    where: { email: { startsWith: "syn_" } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  console.log(`[Users] Retrieved ${userIds.length} user IDs`);

  // 3. Generate 8000 conversations
  console.log("[Conversations] Generating 8000 conversations...");
  const convoBatch: any[] = [];
  for (let i = 0; i < 8000; i++) {
    const type = rng.next() < 0.7 ? "DIRECT_MESSAGE" : "GROUP_CHAT";
    const creatorId = rng.choice(userIds);
    convoBatch.push({
      type,
      name: type === "GROUP_CHAT" ? `Group ${i}` : null,
      creatorId,
    });

    if (convoBatch.length >= 1000) {
      await prisma.conversation.createMany({ data: convoBatch as any });
      convoBatch.length = 0;
    }
  }
  if (convoBatch.length > 0) {
    await prisma.conversation.createMany({ data: convoBatch as any });
  }
  console.log("[Conversations] ✓ Created 8000 conversations");

  // 4. Get conversation IDs
  const convos = await prisma.conversation.findMany({
    select: { id: true, creatorId: true, type: true },
  });
  console.log(`[Conversations] Retrieved ${convos.length} conversation IDs`);

  // 5. Create conversation memberships
  console.log("[ConvoUsers] Creating memberships...");
  const memberBatch = [];
  for (const convo of convos) {
    const memberCount =
      convo.type === "DIRECT_MESSAGE" ? 2 : rng.nextInt(3, 10);
    const selectedUsers = [];
    selectedUsers.push(convo.creatorId); // Creator is always a member

    // Add random members
    while (selectedUsers.length < memberCount) {
      const userId = rng.choice(userIds);
      if (!selectedUsers.includes(userId)) {
        selectedUsers.push(userId);
      }
    }

    for (const userId of selectedUsers) {
      memberBatch.push({
        conversationId: convo.id,
        userId,
        isActive: true,
      });
    }

    if (memberBatch.length >= 5000) {
      await prisma.conversationUser.createMany({
        data: memberBatch,
        skipDuplicates: true,
      });
      memberBatch.length = 0;
    }
  }
  if (memberBatch.length > 0) {
    await prisma.conversationUser.createMany({
      data: memberBatch,
      skipDuplicates: true,
    });
  }
  console.log("[ConvoUsers] ✓ Created memberships");

  // 6. Generate 500K messages (manageable size for dev)
  console.log("[Messages] Generating 500K messages...");
  const targetMessages = 500000;
  const msgBatch: any[] = [];
  let msgCount = 0;

  const convosWithMembers = await prisma.conversation.findMany({
    include: { conversationUsers: { select: { userId: true } } },
  });

  const msgsPerConvo = Math.ceil(targetMessages / convosWithMembers.length);

  for (const convo of convosWithMembers) {
    const members = convo.conversationUsers.map((cu) => cu.userId);
    if (members.length === 0) continue;

    const baseTime = new Date("2025-10-01").getTime();

    for (let i = 0; i < msgsPerConvo && msgCount < targetMessages; i++) {
      const msgType =
        rng.next() < 0.85 ? "TEXT" : rng.next() < 0.7 ? "IMAGE" : "FILE";
      const content = Array(rng.nextInt(5, 15))
        .fill(0)
        .map(() => rng.choice(words))
        .join(" ");
      const timestamp = new Date(
        baseTime + rng.nextInt(0, 20 * 24 * 3600 * 1000),
      );

      msgBatch.push({
        conversationId: convo.id,
        senderId: rng.choice(members),
        content,
        type: msgType,
        createdAt: timestamp,
      });

      msgCount++;

      if (msgBatch.length >= 1000) {
        await prisma.message.createMany({ data: msgBatch as any });
        msgBatch.length = 0;

        if (msgCount % 50000 === 0) {
          console.log(`[Messages] Created ${msgCount}/${targetMessages}`);
        }
      }
    }
  }

  if (msgBatch.length > 0) {
    await prisma.message.createMany({ data: msgBatch as any });
  }

  console.log(`[Messages] ✓ Created ${msgCount} messages`);

  // 7. Summary
  const finalCounts = {
    users: await prisma.user.count({
      where: { email: { startsWith: "syn_" } },
    }),
    conversations: await prisma.conversation.count(),
    messages: await prisma.message.count(),
  };

  console.log("\n=== GENERATION COMPLETE ===");
  console.log(`Users: ${finalCounts.users}`);
  console.log(`Conversations: ${finalCounts.conversations}`);
  console.log(`Messages: ${finalCounts.messages}`);
  console.log("\nDataset ready for validation!");

  await prisma.$disconnect();
}

quickGenerate().catch((err) => {
  console.error("[Error]", err);
  process.exit(1);
});
