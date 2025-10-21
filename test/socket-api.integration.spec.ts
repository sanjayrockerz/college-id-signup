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
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.bootstrap";

const { registerSocketHandlers } = require("../src/socket/handlers");

const isMockPrisma = process.env.PRISMA_CLIENT_MODE === "mock";
const forceMockIntegration = process.env.FORCE_PRISMA_INTEGRATION === "true";
const describeIfSocketSuite = isMockPrisma || forceMockIntegration ? describe : describe.skip;

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
        origin: process.env.CORS_ORIGIN?.split(",") ?? ["http://localhost:3000"],
        credentials: true,
      },
      transports: ["websocket", "polling"],
    });

    registerSocketHandlers(ioServer);

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

  beforeEach((done) => {
    // Create two socket connections for testing
    socket1 = io(serverUrl, {
      transports: ["websocket"],
      reconnection: false,
    });

    socket2 = io(serverUrl, {
      transports: ["websocket"],
      reconnection: false,
    });

    let connectedCount = 0;
    const checkBothConnected = () => {
      connectedCount++;
      if (connectedCount === 2) {
        done();
      }
    };

    socket1.on("connect", checkBothConnected);
    socket2.on("connect", checkBothConnected);
  });

  afterEach(() => {
    if (socket1?.connected) socket1.disconnect();
    if (socket2?.connected) socket2.disconnect();
  });

  describe("Connection", () => {
    it("should connect without authentication", () => {
      expect(socket1.connected).toBe(true);
      expect(socket2.connected).toBe(true);
    });

    it("should NOT require auth token in handshake", () => {
      // Verify no auth query parameter required
      expect(socket1.io.opts.query ?? {}).not.toHaveProperty("token");
      // Socket.IO v3+ no longer uses separate auth object in manager options
    });
  });

  describe("join_conversation event", () => {
    it("should join a conversation with userId", (done) => {
      const conversationId = "test-conv-1";

      socket1.emit("join_conversation", {
        userId: testUserId1,
        conversationId: conversationId,
      });

      socket1.on("conversation_joined", (data) => {
        expect(data.conversationId).toBe(conversationId);
        done();
      });
    });

    it("should reject without userId", (done) => {
      socket1.emit("join_conversation", {
        conversationId: "test-conv-2",
      });

      socket1.on("error", (error) => {
        expect(error.message).toContain("userId");
        done();
      });
    });

    it("should reject without conversationId", (done) => {
      socket1.emit("join_conversation", {
        userId: testUserId1,
      });

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
        userId: testUserId1,
        conversationId: conversationId,
      });

      socket2.emit("join_conversation", {
        userId: testUserId2,
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
        userId: testUserId1,
        conversationId: conversationId,
        content: messageContent,
        messageType: "TEXT",
      });
    });

    it("should reject message without userId", (done) => {
      socket1.emit("send_message", {
        conversationId: conversationId,
        content: "Test",
        messageType: "TEXT",
      });

      socket1.on("error", (error) => {
        expect(error.message).toContain("userId");
        done();
      });
    });

    it("should reject empty message content", (done) => {
      socket1.emit("send_message", {
        userId: testUserId1,
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
        userId: testUserId1,
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
        userId: testUserId1,
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
        userId: testUserId1,
        conversationId: conversationId,
      });

      socket2.emit("join_conversation", {
        userId: testUserId2,
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
        userId: testUserId1,
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
        userId: testUserId1,
        conversationId: conversationId,
        isTyping: false,
      });
    });
  });

  describe("mark_as_read event", () => {
    const conversationId = "test-conv-read";

    beforeEach((done) => {
      socket1.emit("join_conversation", {
        userId: testUserId1,
        conversationId: conversationId,
      });

      socket2.emit("join_conversation", {
        userId: testUserId2,
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
        userId: testUserId2,
        conversationId: conversationId,
        messageIds: messageIds,
      });
    });

    it("should reject without userId", (done) => {
      socket1.emit("mark_as_read", {
        conversationId: conversationId,
        messageIds: ["msg-1"],
      });

      socket1.on("error", (error) => {
        expect(error.message).toContain("userId");
        done();
      });
    });
  });

  describe("leave_conversation event", () => {
    it("should leave a conversation", (done) => {
      const conversationId = "test-conv-leave";

      socket1.emit("join_conversation", {
        userId: testUserId1,
        conversationId: conversationId,
      });

      socket1.on("conversation_joined", () => {
        socket1.emit("leave_conversation", {
          userId: testUserId1,
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
        userId: testUserId1,
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

  describe("No Authentication", () => {
    it("should NOT check Authorization header", () => {
      // Socket connections work without auth
      expect(socket1.connected).toBe(true);
    });

    it("should NOT emit unauthorized errors", (done) => {
      let hasError = false;

      socket1.on("unauthorized", () => {
        hasError = true;
      });

      // Emit events and wait
      socket1.emit("join_conversation", {
        userId: testUserId1,
        conversationId: "test",
      });

      setTimeout(() => {
        expect(hasError).toBe(false);
        done();
      }, 500);
    });

    it("should accept any userId format (opaque metadata)", (done) => {
      const randomUserId = `random-${Math.random()}`;
      const conversationId = "test-conv-random";

      socket1.emit("join_conversation", {
        userId: randomUserId,
        conversationId: conversationId,
      });

      socket1.on("conversation_joined", (data) => {
        expect(data.conversationId).toBe(conversationId);
        done();
      });
    });
  });
});
