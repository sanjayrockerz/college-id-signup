/**
 * Socket.IO Integration Tests - Anonymous Public Access
 *
 * Tests real-time messaging without authentication.
 * All socket connections and events include explicit userId (untrusted).
 */

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { io, Socket } from "socket.io-client";
import { Server } from "socket.io";
import { AddressInfo } from "net";
import { createSecretKey } from "crypto";
import { SignJWT, type JWTPayload } from "jose";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.bootstrap";
import { registerSocketHandlers } from "../src/socket/handlers";
import {
  loadEnvironment,
  resetEnvironmentCacheForTests,
} from "../src/config/environment";

const TEST_SHARED_SECRET = "socket-integration-secret";

process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.JWT_ISSUER = "https://issuer.example.com";
process.env.JWT_AUDIENCE = "chat-backend";
process.env.PUBLIC_KEYS = TEST_SHARED_SECRET;
process.env.TOKEN_LEEWAY_SEC = "10";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://user:pass@localhost:5432/chat_test";

resetEnvironmentCacheForTests();
loadEnvironment();

const sharedSecretKey = createSecretKey(
  Buffer.from(TEST_SHARED_SECRET, "utf-8"),
);

async function signTestToken(
  userId: string,
  overrides: Partial<JWTPayload> = {},
): Promise<string> {
  return new SignJWT({ sub: userId, ...overrides })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(process.env.JWT_ISSUER!)
    .setAudience(process.env.JWT_AUDIENCE!)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(sharedSecretKey);
}

const isMockPrisma = process.env.PRISMA_CLIENT_MODE === "mock";
const forceMockIntegration = process.env.FORCE_PRISMA_INTEGRATION === "true";
const describeIfSocketSuite =
  isMockPrisma || forceMockIntegration ? describe : describe.skip;

describeIfSocketSuite("Socket.IO API (Anonymous Access)", () => {
  let app: INestApplication;
  let serverUrl: string;
  let ioServer: Server;
  let socket1: Socket;
  let socket2: Socket;

  const testUserId1 = "socket-test-user-1";
  const testUserId2 = "socket-test-user-2";

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await configureApp(app);
    await app.listen(0); // Random port

    const httpServer = app.getHttpServer();

    ioServer = new Server(httpServer, {
      cors: {
        origin: process.env.CORS_ORIGIN?.split(",") ?? [
          "http://localhost:3000",
        ],
        credentials: true,
      },
      transports: ["websocket", "polling"],
    });

    await registerSocketHandlers(ioServer, {
      realtime: {
        ...loadEnvironment().realtime,
        adapterEnabled: false,
      },
    });

    const address = httpServer.address() as AddressInfo;
    const port = address.port;
    serverUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    if (ioServer) {
      await new Promise<void>((resolve, reject) => {
        ioServer.close((err?: Error) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }

    await app.close();
  });

  beforeEach(async () => {
    const [token1, token2] = await Promise.all([
      signTestToken(testUserId1),
      signTestToken(testUserId2),
    ]);

    socket1 = io(serverUrl, {
      transports: ["websocket"],
      reconnection: false,
      auth: { token: token1 },
    });

    socket2 = io(serverUrl, {
      transports: ["websocket"],
      reconnection: false,
      auth: { token: token2 },
    });

    await new Promise<void>((resolve, reject) => {
      function cleanup() {
        socket1.off("connect", handleConnect);
        socket2.off("connect", handleConnect);
        socket1.off("connect_error", handleError);
        socket2.off("connect_error", handleError);
      }

      function handleConnect() {
        if (socket1.connected && socket2.connected) {
          cleanup();
          resolve();
        }
      }

      function handleError(err: Error) {
        cleanup();
        reject(err);
      }

      socket1.on("connect", handleConnect);
      socket2.on("connect", handleConnect);
      socket1.on("connect_error", handleError);
      socket2.on("connect_error", handleError);
    });
  });

  afterEach(() => {
    if (socket1?.connected) socket1.disconnect();
    if (socket2?.connected) socket2.disconnect();
  });

  describe("Connection", () => {
    it("allows connections when a valid token is provided", () => {
      expect(socket1.connected).toBe(true);
      expect(socket2.connected).toBe(true);
    });

    it("rejects connections that omit the token", (done) => {
      const unauthenticated = io(serverUrl, {
        transports: ["websocket"],
        reconnection: false,
      });

      unauthenticated.on("connect", () => {
        done.fail("Expected connection to be rejected");
      });

      unauthenticated.on("connect_error", (error) => {
        expect(error?.message).toContain("auth_failure");
        unauthenticated.close();
        done();
      });
    });
  });

  describe("join_conversation event", () => {
    it("should join a conversation with the authenticated identity", (done) => {
      const conversationId = "test-conv-1";

      socket1.emit("join_conversation", {
        conversationId,
      });

      socket1.on("conversation_joined", (data) => {
        expect(data.conversationId).toBe(conversationId);
        expect(data.userId).toBe(testUserId1);
        done();
      });
    });

    it("should reject when payload userId mismatches authenticated user", (done) => {
      socket1.emit("join_conversation", {
        conversationId: "test-conv-2",
        userId: "impersonator",
      });

      socket1.on("error", (error) => {
        expect(error.message).toContain("mismatch");
        done();
      });
    });

    it("should reject without conversationId", (done) => {
      socket1.emit("join_conversation", {});

      socket1.on("error", (error) => {
        expect(error.message).toContain("conversationId");
        done();
      });
    });
  });

  describe("send_message event", () => {
    const conversationId = "test-conv-broadcast";

    beforeEach((done) => {
      // Join both users to same conversation
      socket1.emit("join_conversation", {
        conversationId: conversationId,
      });

      socket2.emit("join_conversation", {
        conversationId: conversationId,
      });

      let joinedCount = 0;
      const checkBothJoined = () => {
        joinedCount++;
        if (joinedCount === 2) {
          done();
        }
      };

      socket1.on("conversation_joined", checkBothJoined);
      socket2.on("conversation_joined", checkBothJoined);
    });

    it("should send and receive messages between users", (done) => {
      const messageContent = "Hello from socket1!";

      socket2.on("new_message", (message) => {
        expect(message.content).toBe(messageContent);
        expect(message.conversationId).toBe(conversationId);
        expect(message.senderId).toBe(testUserId1);
        done();
      });

      socket1.emit("send_message", {
        conversationId: conversationId,
        content: messageContent,
        messageType: "TEXT",
      });
    });

    it("should reject message when payload userId mismatches", (done) => {
      socket1.emit("send_message", {
        conversationId: conversationId,
        userId: "other-user",
        content: "Test",
        messageType: "TEXT",
      });

      socket1.on("error", (error) => {
        expect(error.message).toContain("mismatch");
        done();
      });
    });

    it("should reject empty message content", (done) => {
      socket1.emit("send_message", {
        conversationId: conversationId,
        content: "",
        messageType: "TEXT",
      });

      socket1.on("error", (error) => {
        expect(error.message).toContain("content");
        done();
      });
    });

    it("should reject message exceeding size limit", (done) => {
      const longContent = "a".repeat(10001);

      socket1.emit("send_message", {
        conversationId: conversationId,
        content: longContent,
        messageType: "TEXT",
      });

      socket1.on("error", (error) => {
        expect(error.message).toContain("too long");
        done();
      });
    });

    it("should support different message types", (done) => {
      socket2.on("new_message", (message) => {
        expect(message.messageType).toBe("IMAGE");
        expect(message.mediaUrl).toBeDefined();
        done();
      });

      socket1.emit("send_message", {
        conversationId: conversationId,
        content: "Image message",
        messageType: "IMAGE",
        mediaUrl: "https://example.com/image.jpg",
      });
    });
  });

  describe("typing_indicator event", () => {
    const conversationId = "test-conv-typing";

    beforeEach((done) => {
      socket1.emit("join_conversation", {
        conversationId: conversationId,
      });

      socket2.emit("join_conversation", {
        conversationId: conversationId,
      });

      let joinedCount = 0;
      const checkBothJoined = () => {
        joinedCount++;
        if (joinedCount === 2) {
          done();
        }
      };

      socket1.on("conversation_joined", checkBothJoined);
      socket2.on("conversation_joined", checkBothJoined);
    });

    it("should broadcast typing indicator to other users", (done) => {
      socket2.on("user_typing", (data) => {
        expect(data.userId).toBe(testUserId1);
        expect(data.conversationId).toBe(conversationId);
        expect(data.isTyping).toBe(true);
        done();
      });

      socket1.emit("typing_indicator", {
        conversationId: conversationId,
        isTyping: true,
      });
    });

    it("should handle typing stopped indicator", (done) => {
      socket2.on("user_typing", (data) => {
        expect(data.isTyping).toBe(false);
        done();
      });

      socket1.emit("typing_indicator", {
        conversationId: conversationId,
        isTyping: false,
      });
    });
  });

  describe("mark_as_read event", () => {
    const conversationId = "test-conv-read";

    beforeEach((done) => {
      socket1.emit("join_conversation", {
        conversationId: conversationId,
      });

      socket2.emit("join_conversation", {
        conversationId: conversationId,
      });

      let joinedCount = 0;
      const checkBothJoined = () => {
        joinedCount++;
        if (joinedCount === 2) {
          done();
        }
      };

      socket1.on("conversation_joined", checkBothJoined);
      socket2.on("conversation_joined", checkBothJoined);
    });

    it("should broadcast read receipts to other users", (done) => {
      const messageIds = ["msg-1", "msg-2", "msg-3"];

      socket1.on("messages_read", (data) => {
        expect(data.userId).toBe(testUserId2);
        expect(data.conversationId).toBe(conversationId);
        expect(data.messageIds).toEqual(messageIds);
        done();
      });

      socket2.emit("mark_as_read", {
        conversationId: conversationId,
        messageIds: messageIds,
      });
    });

    it("should reject when payload userId mismatches", (done) => {
      socket1.emit("mark_as_read", {
        conversationId: conversationId,
        userId: "impersonator",
        messageIds: ["msg-1"],
      });

      socket1.on("error", (error) => {
        expect(error.message).toContain("mismatch");
        done();
      });
    });
  });

  describe("leave_conversation event", () => {
    it("should leave a conversation", (done) => {
      const conversationId = "test-conv-leave";

      socket1.emit("join_conversation", {
        conversationId: conversationId,
      });

      socket1.on("conversation_joined", () => {
        socket1.emit("leave_conversation", {
          conversationId: conversationId,
        });

        socket1.on("conversation_left", (data) => {
          expect(data.conversationId).toBe(conversationId);
          done();
        });
      });
    });
  });

  describe("Disconnect handling", () => {
    it("should handle disconnection gracefully", (done) => {
      socket1.on("disconnect", () => {
        expect(socket1.connected).toBe(false);
        done();
      });

      socket1.disconnect();
    });

    it("should clean up user state on disconnect", (done) => {
      const conversationId = "test-conv-disconnect";

      socket1.emit("join_conversation", {
        conversationId: conversationId,
      });

      socket1.on("conversation_joined", () => {
        socket1.disconnect();

        // Wait for disconnect to process
        setTimeout(() => {
          expect(socket1.connected).toBe(false);
          done();
        }, 100);
      });
    });
  });

  describe("Authentication enforcement", () => {
    it("rejects connections with an invalid signature", (done) => {
      const forgedSecret = createSecretKey(
        Buffer.from("invalid-secret", "utf-8"),
      );

      new SignJWT({ sub: testUserId1 })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setIssuer(process.env.JWT_ISSUER!)
        .setAudience(process.env.JWT_AUDIENCE!)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(forgedSecret)
        .then((badToken) => {
          const client = io(serverUrl, {
            transports: ["websocket"],
            reconnection: false,
            auth: { token: badToken },
          });

          client.on("connect", () => {
            client.close();
            done.fail("Expected invalid token to be rejected");
          });

          client.on("connect_error", (error) => {
            expect(error?.message).toContain("auth_failure");
            client.close();
            done();
          });
        })
        .catch(done);
    });

    it("rejects connections when the token is expired", async () => {
      const now = Math.floor(Date.now() / 1000);
      const expiredToken = await new SignJWT({ sub: testUserId1 })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setIssuer(process.env.JWT_ISSUER!)
        .setAudience(process.env.JWT_AUDIENCE!)
        .setIssuedAt(now - 180)
        .setExpirationTime(now - 60)
        .sign(sharedSecretKey);

      await new Promise<void>((resolve, reject) => {
        const client = io(serverUrl, {
          transports: ["websocket"],
          reconnection: false,
          auth: { token: expiredToken },
        });

        client.on("connect", () => {
          client.close();
          reject(new Error("Expired token unexpectedly accepted"));
        });

        client.on("connect_error", (error) => {
          expect(error?.message).toContain("auth_failure");
          client.close();
          resolve();
        });
      });
    });
  });
});
