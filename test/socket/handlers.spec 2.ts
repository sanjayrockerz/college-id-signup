import { registerSocketHandlers } from "../../src/socket/handlers";
import {
  initializeSocketTestEnvironment,
  MockIo,
  MockSocket,
} from "./helpers/socketTestUtils";

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

initializeSocketTestEnvironment();

describe("socket handlers handshake guard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.conversationUser.findFirst.mockReset();
    mockPrisma.conversation.findMany.mockReset();
    mockPrisma.$transaction.mockReset();
    mockPrisma.messageRead.upsert.mockReset();
    mockPrisma.conversation.findMany.mockResolvedValue([]);
    mockPrisma.$transaction.mockImplementation(async () => undefined);
    mockPrisma.messageRead.upsert.mockResolvedValue(undefined);
  });

  it("rejects sockets without authentication token", async () => {
    const io = new MockIo();
    const connectionHandler = jest.fn();
    io.on("connection", connectionHandler);
    registerSocketHandlers(io as any);

    await expect(
      io.connect({ userId: "user-unauthenticated", token: null }),
    ).rejects.toThrow("auth_failure");

    expect(connectionHandler).not.toHaveBeenCalled();
  });

  it("emits read receipts when mark_as_read succeeds", async () => {
    const upsertMock = jest.fn().mockResolvedValue(undefined);
    mockPrisma.$transaction.mockImplementation(async (callback: any) => {
      await callback({
        messageRead: {
          upsert: upsertMock,
        },
      });
    });

    const io = new MockIo();
    registerSocketHandlers(io as any);

    const socket = (await io.connect({ userId: "user-456" })) as MockSocket;
    const handler = socket.getHandler("mark_as_read");
    expect(handler).toBeDefined();

    await handler({
      conversationId: "conversation-42",
      userId: "user-456",
      messageIds: ["msg-1", "msg-2"],
    });

    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(upsertMock).toHaveBeenCalledTimes(2);
    expect(socket.broadcastEmit).toHaveBeenCalledWith(
      "messages_read",
      expect.objectContaining({
        conversationId: "conversation-42",
        userId: "user-456",
        messageIds: ["msg-1", "msg-2"],
      }),
    );
  });
});
