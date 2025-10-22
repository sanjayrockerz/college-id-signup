import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding test data for cache testing...");

  // Create test users
  const user1 = await prisma.user.upsert({
    where: { id: "user-1" },
    update: {},
    create: {
      id: "user-1",
      username: "testuser1",
      email: "test1@example.com",
      firstName: "Test",
      lastName: "User One",
    },
  });

  const user2 = await prisma.user.upsert({
    where: { id: "user-2" },
    update: {},
    create: {
      id: "user-2",
      username: "testuser2",
      email: "test2@example.com",
      firstName: "Test",
      lastName: "User Two",
    },
  });

  console.log("✅ Created users:", user1.username, user2.username);

  // Create test conversation
  const conversation = await prisma.conversation.upsert({
    where: { id: "conv-1" },
    update: {},
    create: {
      id: "conv-1",
      type: "DIRECT_MESSAGE",
      name: "Test Conversation",
      isActive: true,
      creatorId: user1.id,
    },
  });

  console.log("✅ Created conversation:", conversation.id);

  // Add participants
  await prisma.conversationUser.upsert({
    where: {
      userId_conversationId: {
        userId: user1.id,
        conversationId: conversation.id,
      },
    },
    update: {},
    create: {
      userId: user1.id,
      conversationId: conversation.id,
      isActive: true,
      role: "OWNER",
    },
  });

  await prisma.conversationUser.upsert({
    where: {
      userId_conversationId: {
        userId: user2.id,
        conversationId: conversation.id,
      },
    },
    update: {},
    create: {
      userId: user2.id,
      conversationId: conversation.id,
      isActive: true,
      role: "MEMBER",
    },
  });

  console.log("✅ Added conversation participants");

  // Create test messages
  for (let i = 1; i <= 10; i++) {
    await prisma.message.upsert({
      where: { id: `msg-${i}` },
      update: {},
      create: {
        id: `msg-${i}`,
        conversationId: conversation.id,
        senderId: i % 2 === 0 ? user1.id : user2.id,
        content: `Test message ${i} for cache testing`,
        type: "TEXT",
        status: "SENT",
        isDeleted: false,
      },
    });
  }

  console.log("✅ Created 10 test messages");

  console.log("");
  console.log("🎉 Seed complete! You can now test with:");
  console.log("   - Conversation ID: conv-1");
  console.log("   - User IDs: user-1, user-2");
  console.log("");
}

main()
  .catch((e) => {
    console.error("❌ Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
