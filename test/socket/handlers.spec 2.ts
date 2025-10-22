import { EventEmitter } from "events";

const mockPrisma = {
  conversationUser: {
    findFirst: jest.fn(),
  },
  conversation: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  $transaction: jest.fn(),
  messageRead: {
    upsert: jest.fn(),
  },
};

jest.mock("../../src/config/database", () => ({
  getPrismaClient: jest.fn(() => mockPrisma),
}));

const { registerSocketHandlers } = require("../../src/socket/handlers");

class MockSocket extends EventEmitter {
  id: string;
  handshake: { query: Record<string, string> };
  userId?: string;
  private handlers: Record<string, (...args: any[]) => any> = {};
  rooms: Set<string> = new Set();
  private broadcastEmit = jest.fn();

  constructor(userId?: string) {
    super();
    this.id = `socket-${Math.random().toString(36).slice(2)}`;
    this.handshake = { query: userId ? { userId } : {} };
    this.userId = userId;
  }

  on(event: string, handler: (...args: any[]) => any): this {
    this.handlers[event] = handler;
    return this;
  }

  getHandler(event: string) {
    return this.handlers[event];
  }

  join(room: string) {
    this.rooms.add(room);
  }

  leave(room: string) {
    this.rooms.delete(room);
  }

  to() {
    return { emit: this.broadcastEmit };
  }

  emit = jest.fn((event: string, payload?: any) => {
    const shouldPropagateError =
      event === "error" && this.listenerCount("error") === 0;

    if (!shouldPropagateError) {
      EventEmitter.prototype.emit.call(this, event, payload);
    }

    return true;
  });
}

class MockIo {
  private connectionHandlers: ((socket: MockSocket) => void)[] = [];

  on(event: string, handler: (socket: MockSocket) => void) {
    if (event === "connection") {
      this.connectionHandlers.push(handler);
    }
  }

  connect(userId?: string) {
    const socket = new MockSocket(userId);
    this.connectionHandlers.forEach((handler) => handler(socket));
    return socket;
  }
}

describe("socket handlers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects send_message for non-member sockets", async () => {
    mockPrisma.conversationUser.findFirst.mockResolvedValueOnce(null);

    const io = new MockIo();
    registerSocketHandlers(io as any);

    const socket = io.connect("user-123");
    const sendMessageHandler = socket.getHandler("send_message");
    expect(sendMessageHandler).toBeDefined();

    await sendMessageHandler({
      conversationId: "conversation-1",
      userId: "user-123",
      content: "hello world",
    });

    expect(socket.emit).toHaveBeenCalledWith(
      "error",
      expect.objectContaining({ message: "You are not a participant in this conversation" }),
    );
  });
});
