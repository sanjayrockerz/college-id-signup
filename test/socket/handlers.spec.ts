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

import { registerSocketHandlers } from "../../src/socket/handlers";
import {
  initializeSocketTestEnvironment,
  MockIo,
} from "./helpers/socketTestUtils";

initializeSocketTestEnvironment();

describe("socket handlers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.conversationUser.findFirst.mockReset();
    mockPrisma.conversation.findMany.mockReset();
    mockPrisma.$transaction.mockReset();
    mockPrisma.messageRead.upsert.mockReset();
    mockPrisma.conversation.findMany.mockResolvedValue([]);
    mockPrisma.$transaction.mockImplementation(async () => undefined);
  });

  it("rejects send_message for non-member sockets", async () => {
    mockPrisma.conversationUser.findFirst.mockResolvedValueOnce(null);

    const io = new MockIo();
    registerSocketHandlers(io as any);

    const socket = await io.connect({ userId: "user-123" });
    const sendMessageHandler = socket.getHandler("send_message");
    expect(sendMessageHandler).toBeDefined();

    await sendMessageHandler({
      conversationId: "conversation-1",
      userId: "user-123",
      content: "hello world",
    });

    expect(socket.emit).toHaveBeenCalledWith(
      "error",
      expect.objectContaining({
        message: "You are not a participant in this conversation",
      }),
    );
  });
});
