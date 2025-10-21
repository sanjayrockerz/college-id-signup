/**
 * Chat API Integration Tests - Anonymous Public Access
 *
 * Tests chat functionality without authentication.
 * All requests include explicit userId parameter (untrusted, opaque metadata).
 */

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.bootstrap";

const isMockPrisma = process.env.PRISMA_CLIENT_MODE === "mock";
const forceMockIntegration = process.env.FORCE_PRISMA_INTEGRATION === "true";
const describeIfDatabase = isMockPrisma && !forceMockIntegration ? describe.skip : describe;

describeIfDatabase("Chat API (Anonymous Access)", () => {
  let app: INestApplication;

  // Test user IDs (opaque metadata, not validated)
  const testUserId1 = "test-user-1";
  const testUserId2 = "test-user-2";
  let conversationId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("POST /api/v1/chat/conversations", () => {
    it("should create a direct conversation with userId in body", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/v1/chat/conversations")
        .send({
          userId: testUserId1,
          type: "DIRECT",
          participantIds: [testUserId2],
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty("conversation");

      const conversation = response.body.conversation;
      expect(conversation).toBeDefined();
      expect(conversation.type).toBe("DIRECT");
      expect(Array.isArray(conversation.participants)).toBe(true);

      conversationId = conversation.id;
    });

    it("should create a group conversation", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/v1/chat/conversations")
        .send({
          userId: testUserId1,
          type: "GROUP",
          title: "Test Group",
          description: "A test group conversation",
          participantIds: [testUserId2, "test-user-3"],
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty("conversation");

      const conversation = response.body.conversation;
      expect(conversation.type).toBe("GROUP");
      expect(conversation.title).toBe("Test Group");
    });

    it("should reject request without userId", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/chat/conversations")
        .send({
          type: "DIRECT",
          participantIds: [testUserId1, testUserId2],
        })
        .expect(400)
        .expect((res) => {
          expect(res.body.message).toContain("userId");
        });
    });

    it("should reject invalid type", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/chat/conversations")
        .send({
          userId: testUserId1,
          type: "INVALID",
          participantIds: [testUserId2],
        })
        .expect(400)
        .expect((res) => {
          expect(res.body.message).toContain("Invalid conversation type");
        });
    });

    it("should reject empty participantIds", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/chat/conversations")
        .send({
          userId: testUserId1,
          type: "DIRECT",
          participantIds: [],
        })
        .expect(400);
    });
  });

  describe("GET /api/v1/chat/conversations", () => {
    it("should get user conversations with userId query param", async () => {
      const response = await request(app.getHttpServer())
        .get("/api/v1/chat/conversations")
        .query({ userId: testUserId1, limit: 20 })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty("data");
      expect(Array.isArray(response.body.data.conversations)).toBe(true);
    });

    it("should reject request without userId", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/chat/conversations")
        .expect(400)
        .expect((res) => {
          expect(res.body.message).toContain("userId");
        });
    });

    it("should support pagination with limit and cursor", async () => {
      const response = await request(app.getHttpServer())
        .get("/api/v1/chat/conversations")
        .query({ userId: testUserId1, limit: 10 })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty("data");
      // May have cursor if more results available
      if (response.body.data.hasMore) {
        expect(response.body.data.nextCursor).toBeDefined();
      }
    });
  });

  describe("POST /api/v1/chat/conversations/:conversationId/messages", () => {
    it("should send a text message", async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/v1/chat/conversations/${conversationId}/messages`)
        .send({
          userId: testUserId1,
          content: "Hello, this is a test message!",
          messageType: "TEXT",
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty("message");
      expect(response.body.message.content).toBe(
        "Hello, this is a test message!",
      );
      expect(response.body.message.messageType).toBe("TEXT");
    });

    it("should reject message without userId", async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/chat/conversations/${conversationId}/messages`)
        .send({
          content: "Test message",
          messageType: "TEXT",
        })
        .expect(400);
    });

    it("should reject empty message content", async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/chat/conversations/${conversationId}/messages`)
        .send({
          userId: testUserId1,
          content: "",
          messageType: "TEXT",
        })
        .expect(400);
    });

    it("should reject message exceeding size limit", async () => {
      const longContent = "a".repeat(10001); // Exceeds 10k character limit

      await request(app.getHttpServer())
        .post(`/api/v1/chat/conversations/${conversationId}/messages`)
        .send({
          userId: testUserId1,
          content: longContent,
          messageType: "TEXT",
        })
        .expect(400)
        .expect((res) => {
          expect(res.body.message).toContain("too long");
        });
    });
  });

  describe("GET /api/v1/chat/conversations/:conversationId/messages", () => {
    it("should get conversation messages with userId", async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/chat/conversations/${conversationId}/messages`)
        .query({ userId: testUserId1, limit: 50 })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty("data");
      expect(Array.isArray(response.body.data.messages)).toBe(true);
    });

    it("should support pagination", async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/chat/conversations/${conversationId}/messages`)
        .query({ userId: testUserId1, limit: 10 })
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(response.body.data.messages.length).toBeLessThanOrEqual(10);
    });

    it("should reject request without userId", async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/chat/conversations/${conversationId}/messages`)
        .expect(400);
    });
  });

  describe("PUT /api/v1/chat/conversations/:conversationId/messages/read", () => {
    it("should mark messages as read", async () => {
      // First, get some message IDs
      const messagesResponse = await request(app.getHttpServer())
        .get(`/api/v1/chat/conversations/${conversationId}/messages`)
        .query({ userId: testUserId2, limit: 5 })
        .expect(200);

      const messageIds = messagesResponse.body.data.messages.map(
        (m: any) => m.id,
      );

      if (messageIds.length > 0) {
        await request(app.getHttpServer())
          .put(`/api/v1/chat/conversations/${conversationId}/messages/read`)
          .send({
            userId: testUserId2,
            messageIds: messageIds,
          })
          .expect(200);
      }
    });

    it("should reject without userId", async () => {
      await request(app.getHttpServer())
        .put(`/api/v1/chat/conversations/${conversationId}/messages/read`)
        .send({
          messageIds: ["msg-1"],
        })
        .expect(400);
    });
  });

  describe("Rate Limiting", () => {
    it("should include rate limit headers in responses", async () => {
      const response = await request(app.getHttpServer())
        .get("/api/v1/chat/conversations")
        .query({ userId: testUserId1 })
        .expect(200);

      // Rate limit headers should be present
      expect(response.headers["ratelimit-limit"]).toBeDefined();
      expect(response.headers["ratelimit-remaining"]).toBeDefined();
    });
  });

  describe("Request Tracing", () => {
    it("should include X-Request-ID in responses", async () => {
      const response = await request(app.getHttpServer())
        .get("/api/v1/chat/conversations")
        .query({ userId: testUserId1 })
        .expect(200);

      expect(response.headers).toHaveProperty("x-request-id");
      expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("should preserve client-provided request ID", async () => {
      const customRequestId = "12345678-1234-1234-1234-123456789012";

      const response = await request(app.getHttpServer())
        .get("/api/v1/chat/conversations")
        .set("X-Request-ID", customRequestId)
        .query({ userId: testUserId1 })
        .expect(200);

      expect(response.headers["x-request-id"]).toBe(customRequestId);
    });
  });

  describe("Security Headers", () => {
    it("should include security headers in responses", async () => {
      const response = await request(app.getHttpServer())
        .get("/api/v1/chat/health")
        .expect(200);

      expect(response.headers).toHaveProperty(
        "x-content-type-options",
        "nosniff",
      );
      expect(response.headers).toHaveProperty("x-frame-options", "DENY");
      expect(response.headers).toHaveProperty("strict-transport-security");
    });
  });

  describe("No Authentication", () => {
    it("should NOT require Authorization header", async () => {
      // Requests work without Authorization header
      await request(app.getHttpServer())
        .get("/api/v1/chat/conversations")
        .query({ userId: testUserId1 })
        .expect(200);
    });

    it("should NOT return 401 Unauthorized errors", async () => {
      // Missing userId returns 400 Bad Request, not 401 Unauthorized
      const response = await request(app.getHttpServer())
        .post("/api/v1/chat/conversations")
        .send({
          type: "DIRECT",
          participantIds: [testUserId1, testUserId2],
        });

      expect(response.status).toBe(400);
      expect(response.status).not.toBe(401);
    });

    it("should accept any userId (opaque metadata)", async () => {
      // Any userId format is accepted (not validated against user DB)
      const randomUserId = `random-${Math.random()}`;

      await request(app.getHttpServer())
        .get("/api/v1/chat/conversations")
        .query({ userId: randomUserId })
        .expect(200);
    });
  });
});
