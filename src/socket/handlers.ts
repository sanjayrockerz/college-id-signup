import type { Server, Socket, DisconnectReason } from "socket.io";
import type { JWTPayload } from "jose";
import { getPrismaClient } from "../config/database";
import { getEnv, type EnvironmentConfig } from "../config/environment";
import {
  TokenVerifier,
  type TokenVerificationErrorCode,
} from "../common/security/token-verifier";
import {
  SocketMetrics,
  type NormalizedDisconnectReason,
  type HandshakeRejectionReason,
} from "./metrics";
import { StructuredLogger } from "../common/logging/structured-logger";
import { resolveCorrelationId } from "../common/logging/correlation";
import { TelemetryMetrics } from "../observability/metrics-registry";
import { PresenceRegistry } from "../realtime/presence-registry";
import { initializeSocketRedisAdapter } from "./adapter";
import {
  createReplayCache,
  type ReplayCache,
  type ReplayMessage,
} from "../realtime/replay-cache";

const isMockPrismaMode = process.env.PRISMA_CLIENT_MODE === "mock";
const MAX_MESSAGE_LENGTH = 10_000;

interface ClientMetadata {
  readonly ip?: string;
  readonly userAgent?: string;
  readonly appVersion?: string;
  readonly platform?: string;
}

interface AuthContext {
  readonly userId: string;
  readonly tokenClaims: JWTPayload;
  readonly client: ClientMetadata;
}

interface SocketData {
  authContext?: AuthContext;
  connectedAt?: number;
  correlationId?: string;
  heartbeatTimer?: NodeJS.Timeout;
  resumeCursor?: ResumeCursor;
  deliveryState?: DeliveryState;
}

type AuthenticatedSocket = Socket & { data: SocketData };

interface ResumeCursor {
  readonly lastReceivedMessageId: string | null;
}

interface DeliveryState {
  limit: number;
  delivered: Set<string>;
  order: string[];
}

interface MockMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly content: string;
  readonly senderId: string;
  readonly messageType: string;
  readonly mediaUrl: string | null;
  readonly attachments: unknown[];
  readonly createdAt: string;
}

interface MockConversation {
  readonly members: Map<string, string>;
  readonly messages: MockMessage[];
}

const mockStore: { conversations: Map<string, MockConversation> } = {
  conversations: new Map(),
};

let mockMessageCounter = 0;

function ensureMockConversation(conversationId: string): MockConversation {
  let conversation = mockStore.conversations.get(conversationId);
  if (!conversation) {
    conversation = {
      members: new Map(),
      messages: [],
    };
    mockStore.conversations.set(conversationId, conversation);
  }
  return conversation;
}

function mockConversationHasParticipant(
  conversation: MockConversation,
  userId: string,
): boolean {
  for (const participantId of conversation.members.values()) {
    if (participantId === userId) {
      return true;
    }
  }
  return false;
}

const DELIVERY_TRACKED_EVENTS = new Set([
  "new_message",
  "message_sent",
  "replayed_messages",
]);
const DEFAULT_DEDUPE_LIMIT = 200;

function ensureDeliveryState(
  socket: AuthenticatedSocket,
  limit = DEFAULT_DEDUPE_LIMIT,
): DeliveryState {
  if (!socket.data.deliveryState) {
    socket.data.deliveryState = {
      limit,
      delivered: new Set<string>(),
      order: [],
    } satisfies DeliveryState;
  } else if (limit && socket.data.deliveryState.limit !== limit) {
    socket.data.deliveryState.limit = limit;
  }
  return socket.data.deliveryState;
}

function recordDelivery(state: DeliveryState, messageId: string): boolean {
  if (state.delivered.has(messageId)) {
    return false;
  }
  state.delivered.add(messageId);
  state.order.push(messageId);
  if (state.order.length > state.limit) {
    const expired = state.order.shift();
    if (expired) {
      state.delivered.delete(expired);
    }
  }
  return true;
}

function filterDeduplicatedMessages(
  state: DeliveryState,
  messages: ReplayMessage[],
): ReplayMessage[] {
  const filtered: ReplayMessage[] = [];
  let dedupeHits = 0;
  for (const message of messages) {
    if (!message || typeof message.id !== "string") {
      continue;
    }
    const wasRecorded = recordDelivery(state, message.id);
    if (wasRecorded) {
      filtered.push(message);
    } else {
      dedupeHits += 1;
    }
  }

  if (dedupeHits > 0) {
    TelemetryMetrics.incrementDedupeHit("replay", dedupeHits);
  }

  return filtered;
}

function attachDeliveryDeduper(
  socket: AuthenticatedSocket,
  limit = DEFAULT_DEDUPE_LIMIT,
): void {
  const originalEmit = socket.emit.bind(socket);

  ensureDeliveryState(socket, limit);

  socket.emit = function patchedEmit(event: string, ...args: unknown[]) {
    if (!DELIVERY_TRACKED_EVENTS.has(event)) {
      return originalEmit(event, ...args);
    }

    const state = ensureDeliveryState(socket);

    if (event === "replayed_messages") {
      const payload = args[0];
      if (!payload || typeof payload !== "object") {
        return originalEmit(event, ...args);
      }

      const typed = payload as {
        conversationId: string;
        messages?: ReplayMessage[];
      };
      const replayBatch = Array.isArray(typed.messages) ? typed.messages : [];
      const filtered = filterDeduplicatedMessages(state, replayBatch);
      if (filtered.length === 0) {
        return socket;
      }
      typed.messages = filtered;
      return originalEmit(event, ...args);
    }

    const payload = args[0];
    if (
      payload &&
      typeof payload === "object" &&
      "id" in (payload as Record<string, unknown>)
    ) {
      const messageId = (payload as Record<string, unknown>).id;
      if (typeof messageId === "string") {
        recordDelivery(state, messageId);
      }
    }

    return originalEmit(event, ...args);
  } as typeof socket.emit;
}

function extractResumeCursor(socket: Socket): ResumeCursor {
  const authCursor =
    typeof socket.handshake.auth?.lastReceivedMessageId === "string"
      ? socket.handshake.auth.lastReceivedMessageId.trim()
      : undefined;
  const queryCursor =
    typeof socket.handshake.query?.lastReceivedMessageId === "string"
      ? (socket.handshake.query.lastReceivedMessageId as string).trim()
      : undefined;

  const raw = authCursor || queryCursor;
  if (!raw || raw.length === 0 || raw === "null" || raw === "undefined") {
    return { lastReceivedMessageId: null };
  }

  return { lastReceivedMessageId: raw };
}

function emitError(
  socket: Socket,
  message: string,
  context: Record<string, unknown> = {},
): void {
  socket.emit("error", {
    message,
    ...context,
  });
}

function extractHandshakeToken(socket: Socket): string | null {
  const authToken =
    typeof socket.handshake.auth?.token === "string"
      ? socket.handshake.auth.token
      : undefined;
  const queryToken =
    typeof socket.handshake.query?.token === "string"
      ? (socket.handshake.query.token as string)
      : undefined;

  const header = socket.handshake.headers?.["authorization"];
  let headerToken: string | undefined;
  if (typeof header === "string") {
    const trimmed = header.trim();
    headerToken = trimmed.startsWith("Bearer ")
      ? trimmed.slice(7).trim()
      : trimmed;
  }

  return authToken || queryToken || headerToken || null;
}

function gatherClientMetadata(socket: Socket): ClientMetadata {
  const headers = socket.handshake.headers ?? {};
  const forwarded = headers["x-forwarded-for"];
  const ip =
    typeof forwarded === "string"
      ? forwarded.split(",")[0]?.trim()
      : socket.handshake.address;

  return {
    ip,
    userAgent:
      typeof headers["user-agent"] === "string"
        ? (headers["user-agent"] as string)
        : undefined,
    appVersion:
      typeof socket.handshake.query?.appVersion === "string"
        ? (socket.handshake.query?.appVersion as string)
        : undefined,
    platform:
      typeof socket.handshake.query?.platform === "string"
        ? (socket.handshake.query?.platform as string)
        : undefined,
  };
}

function mapTokenErrorToMetricsReason(
  code: TokenVerificationErrorCode,
): HandshakeRejectionReason {
  switch (code) {
    case "missing_token":
      return "missing_token";
    case "malformed_token":
      return "malformed_token";
    case "invalid_signature":
      return "invalid_signature";
    case "invalid_audience":
      return "invalid_audience";
    case "invalid_issuer":
      return "invalid_issuer";
    case "expired":
      return "expired";
    case "not_before":
      return "not_before";
    case "unauthorized":
      return "unauthorized";
    default:
      return "internal_error";
  }
}

function mapTokenErrorToLogReason(code: TokenVerificationErrorCode): string {
  switch (code) {
    case "expired":
      return "expired";
    case "malformed_token":
      return "malformed";
    default:
      return "unauthorized";
  }
}

function normalizeDisconnectReason(
  reason: DisconnectReason | string,
): NormalizedDisconnectReason {
  const value = (reason || "").toString().toLowerCase();

  if (value.includes("auth")) {
    return "auth_failure";
  }

  switch (value) {
    case "ping timeout":
      return "heartbeat_timeout";
    case "transport error":
    case "transport close":
    case "forced close":
    case "client namespace disconnect":
    case "io client disconnect":
      return "transport_error";
    case "server shutting down":
    case "server namespace disconnect":
    case "io server disconnect":
      return "server_shutdown";
    default:
      return "transport_error";
  }
}

function assertAuthContext(socket: AuthenticatedSocket): AuthContext {
  const auth = socket.data.authContext;
  if (!auth) {
    throw new Error("Socket missing authentication context");
  }
  return auth;
}

function getCorrelationId(socket: AuthenticatedSocket): string {
  if (!socket.data.correlationId) {
    socket.data.correlationId = StructuredLogger.generateCorrelationId();
  }
  return socket.data.correlationId;
}

function resolveUserId(
  socket: AuthenticatedSocket,
  providedUserId?: string | null,
): string | null {
  const auth = assertAuthContext(socket);
  if (providedUserId && providedUserId !== auth.userId) {
    emitError(socket, "userId mismatch", {
      expectedUserId: auth.userId,
      providedUserId,
    });
    return null;
  }
  return auth.userId;
}

function registerHandshakeGuard(io: Server, verifier: TokenVerifier): void {
  io.use(async (socket, next) => {
    const typedSocket = socket as AuthenticatedSocket;
    const metadata = gatherClientMetadata(socket);
    typedSocket.data.resumeCursor = extractResumeCursor(socket);
    const correlationId = resolveCorrelationId(
      socket.handshake.auth?.correlationId,
      socket.handshake.query?.correlationId,
      socket.handshake.headers?.["x-correlation-id"],
      socket.handshake.headers?.["x-request-id"],
    );

    typedSocket.data.correlationId = correlationId;

    const token = extractHandshakeToken(socket);
    const startedAt = Date.now();

    if (!token) {
      SocketMetrics.recordHandshake("rejected", "missing_token");
      StructuredLogger.warn("socket.handshake", {
        correlationId,
        status: "rejected",
        durationMs: Date.now() - startedAt,
        data: {
          ip: metadata.ip,
          userAgent: metadata.userAgent,
          detailCode: "missing_token",
        },
      });
      next(new Error("auth_failure"));
      return;
    }

    try {
      const verification = await verifier.verify(token);

      if (verification.ok === false) {
        const rejectionReason = mapTokenErrorToMetricsReason(verification.code);
        SocketMetrics.recordHandshake("rejected", rejectionReason);
        StructuredLogger.warn("socket.handshake", {
          correlationId,
          status: "rejected",
          durationMs: Date.now() - startedAt,
          data: {
            ip: metadata.ip,
            userAgent: metadata.userAgent,
            detailCode: verification.code,
          },
          error: {
            code: verification.code,
            message: "Token verification failed",
          },
        });
        next(new Error("auth_failure"));
        return;
      }

      const authContext: AuthContext = {
        userId: verification.userId,
        tokenClaims: verification.payload,
        client: metadata,
      };

      typedSocket.data.authContext = authContext;

      SocketMetrics.recordHandshake("accepted");
      StructuredLogger.info("socket.handshake", {
        correlationId,
        userId: verification.userId,
        status: "accepted",
        durationMs: Date.now() - startedAt,
        data: {
          ip: metadata.ip,
          userAgent: metadata.userAgent,
        },
      });
      next();
    } catch (error) {
      SocketMetrics.recordHandshake("rejected", "internal_error");
      StructuredLogger.error("socket.handshake", {
        correlationId,
        status: "rejected",
        durationMs: Date.now() - startedAt,
        data: {
          ip: metadata.ip,
          userAgent: metadata.userAgent,
          detailCode: "internal_error",
        },
        error: {
          code: "internal_error",
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
      });
      next(new Error("auth_failure"));
    }
  });
}

interface LifecycleOptions {
  readonly presenceRegistry: PresenceRegistry | null;
  readonly heartbeatIntervalMs: number;
  readonly dedupeLimit: number;
}

function registerLifecycleInstrumentation(
  io: Server,
  options: LifecycleOptions,
): void {
  const { presenceRegistry, heartbeatIntervalMs, dedupeLimit } = options;
  io.on("connection", (rawSocket: Socket) => {
    const socket = rawSocket as AuthenticatedSocket;
    const auth = socket.data.authContext;
    const correlationId =
      socket.data.correlationId ??
      resolveCorrelationId(
        socket.handshake.auth?.correlationId,
        socket.handshake.query?.correlationId,
        socket.handshake.headers?.["x-correlation-id"],
        socket.handshake.headers?.["x-request-id"],
      );

    socket.data.correlationId = correlationId;

    socket.data.connectedAt = Date.now();
    SocketMetrics.incrementConnections();

    attachDeliveryDeduper(socket, dedupeLimit);

    StructuredLogger.info("socket.connection", {
      correlationId,
      userId: auth?.userId,
      status: "connected",
      data: {
        ip: auth?.client.ip,
        userAgent: auth?.client.userAgent,
        socketId: socket.id,
      },
    });

    if (presenceRegistry && auth) {
      void presenceRegistry
        .registerConnection(auth.userId, socket.id, {
          agent: auth.client.userAgent,
        })
        .catch((error) => {
          StructuredLogger.warn("presence.register", {
            userId: auth.userId,
            status: "error",
            data: {
              socketId: socket.id,
            },
            error: {
              code: "presence.register_failed",
              message: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            },
          });
        });

      if (heartbeatIntervalMs > 0) {
        const interval = setInterval(() => {
          void presenceRegistry
            ?.extendHeartbeat(auth.userId, socket.id)
            .catch((error) => {
              StructuredLogger.warn("presence.heartbeat", {
                userId: auth.userId,
                status: "error",
                data: {
                  socketId: socket.id,
                },
                error: {
                  code: "presence.heartbeat_failed",
                  message:
                    error instanceof Error ? error.message : String(error),
                  stack: error instanceof Error ? error.stack : undefined,
                },
              });
            });
        }, heartbeatIntervalMs);
        if (interval.unref) {
          interval.unref();
        }
        socket.data.heartbeatTimer = interval;
      }
    }

    socket.on("disconnect", async (reason: DisconnectReason | string) => {
      const normalized = normalizeDisconnectReason(reason);
      SocketMetrics.recordDisconnect(normalized);
      SocketMetrics.decrementConnections();

      const connectionDurationMs = socket.data.connectedAt
        ? Date.now() - socket.data.connectedAt
        : undefined;

      StructuredLogger.info("socket.disconnect", {
        correlationId,
        userId: auth?.userId,
        status: "closed",
        durationMs: connectionDurationMs,
        data: {
          reason: normalized,
          rawReason: reason,
          ip: auth?.client.ip,
          socketId: socket.id,
        },
      });

      if (socket.data.heartbeatTimer) {
        clearInterval(socket.data.heartbeatTimer);
        socket.data.heartbeatTimer = undefined;
      }

      if (presenceRegistry && auth) {
        try {
          await presenceRegistry.unregister(auth.userId, socket.id);
        } catch (error) {
          StructuredLogger.warn("presence.unregister", {
            userId: auth.userId,
            status: "error",
            data: {
              socketId: socket.id,
            },
            error: {
              code: "presence.unregister_failed",
              message: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            },
          });
        }
      }
    });
  });
}

function buildMockMessage(payload: {
  conversationId: string;
  content: string;
  senderId: string;
  messageType: string;
  mediaUrl?: string | null;
  attachments?: unknown[];
}): MockMessage {
  const normalizedContent = payload.content.trim();
  return {
    id: `mock-msg-${++mockMessageCounter}`,
    conversationId: payload.conversationId,
    content: normalizedContent,
    senderId: payload.senderId,
    messageType: payload.messageType,
    mediaUrl: payload.mediaUrl ?? null,
    attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
    createdAt: new Date().toISOString(),
  };
}

function registerMockSocketHandlers(io: Server): void {
  io.on("connection", (rawSocket: Socket) => {
    const socket = rawSocket as AuthenticatedSocket;
    const joinedConversations = new Set<string>();

    socket.on("join_conversation", (payload: any = {}) => {
      const conversationId = payload?.conversationId as string | undefined;
      const resolvedUserId = resolveUserId(socket, payload?.userId);

      if (!conversationId) {
        emitError(socket, "conversationId is required");
        return;
      }

      if (!resolvedUserId) {
        return;
      }

      const conversation = ensureMockConversation(conversationId);
      conversation.members.set(socket.id, resolvedUserId);
      joinedConversations.add(conversationId);

      socket.join(`conversation_${conversationId}`);

      socket.emit("conversation_joined", {
        conversationId,
        userId: resolvedUserId,
        joinedAt: new Date().toISOString(),
      });

      socket.to(`conversation_${conversationId}`).emit("user_joined", {
        conversationId,
        userId: resolvedUserId,
        socketId: socket.id,
        timestamp: new Date().toISOString(),
      });
    });

    socket.on("leave_conversation", (payload: any = {}) => {
      const conversationId = payload?.conversationId as string | undefined;
      if (!conversationId) {
        emitError(socket, "conversationId is required");
        return;
      }

      const resolvedUserId = resolveUserId(socket, payload?.userId);
      const conversation = mockStore.conversations.get(conversationId);

      if (conversation) {
        conversation.members.delete(socket.id);
      }

      joinedConversations.delete(conversationId);
      socket.leave(`conversation_${conversationId}`);

      socket.emit("conversation_left", {
        conversationId,
        userId: resolvedUserId,
        timestamp: new Date().toISOString(),
      });

      socket.to(`conversation_${conversationId}`).emit("user_left", {
        conversationId,
        userId: resolvedUserId,
        socketId: socket.id,
        timestamp: new Date().toISOString(),
      });
    });

    socket.on("send_message", (payload: any = {}) => {
      const startedAt = Date.now();
      const conversationId = payload?.conversationId as string | undefined;
      const content =
        typeof payload?.content === "string" ? payload.content : "";
      const messageType =
        typeof payload?.messageType === "string" ? payload.messageType : "TEXT";
      const attachments = Array.isArray(payload?.attachments)
        ? payload.attachments
        : [];
      const mediaUrl =
        typeof payload?.mediaUrl === "string" ? payload.mediaUrl : undefined;

      if (!conversationId) {
        TelemetryMetrics.incrementError("send_message");
        emitError(socket, "conversationId is required");
        return;
      }

      const userId = resolveUserId(socket, payload?.userId);
      if (!userId) {
        return;
      }

      const trimmedContent = content.trim();
      if (!trimmedContent && attachments.length === 0 && !mediaUrl) {
        TelemetryMetrics.incrementError("send_message");
        emitError(socket, "Message content is required");
        return;
      }

      if (trimmedContent.length > MAX_MESSAGE_LENGTH) {
        TelemetryMetrics.incrementError("send_message");
        emitError(socket, "Message content is too long");
        return;
      }

      const conversation = ensureMockConversation(conversationId);
      if (!mockConversationHasParticipant(conversation, userId)) {
        TelemetryMetrics.incrementError("send_message");
        emitError(socket, "You are not a participant in this conversation");
        return;
      }

      const message = buildMockMessage({
        conversationId,
        content: trimmedContent,
        senderId: userId,
        messageType,
        mediaUrl,
        attachments,
      });

      conversation.messages.push(message);
      TelemetryMetrics.incrementThroughput("send");
      TelemetryMetrics.observeDeliveryLatency("send", Date.now() - startedAt);

      socket.emit("message_sent", message);
      socket.to(`conversation_${conversationId}`).emit("new_message", message);
      TelemetryMetrics.incrementThroughput("delivered");
    });

    const typingHandler = (payload: any = {}) => {
      const conversationId = payload?.conversationId as string | undefined;
      const isTyping = Boolean(payload?.isTyping);
      if (!conversationId) {
        emitError(socket, "conversationId is required");
        return;
      }

      const userId = resolveUserId(socket, payload?.userId);
      if (!userId) {
        return;
      }

      socket.to(`conversation_${conversationId}`).emit("user_typing", {
        conversationId,
        userId,
        socketId: socket.id,
        isTyping,
        timestamp: new Date().toISOString(),
      });
    };

    socket.on("typing_indicator", typingHandler);
    socket.on("typing_start", (payload: any = {}) =>
      typingHandler({ ...payload, isTyping: true }),
    );
    socket.on("typing_stop", (payload: any = {}) =>
      typingHandler({ ...payload, isTyping: false }),
    );

    const markReadHandler = (payload: any = {}) => {
      const conversationId = payload?.conversationId as string | undefined;
      const messageIds = Array.isArray(payload?.messageIds)
        ? payload.messageIds
        : undefined;

      if (!conversationId) {
        TelemetryMetrics.incrementError("read");
        emitError(socket, "conversationId is required");
        return;
      }

      const userId = resolveUserId(socket, payload?.userId);
      if (!userId) {
        return;
      }

      if (!messageIds || messageIds.length === 0) {
        TelemetryMetrics.incrementError("read");
        emitError(socket, "messageIds must be a non-empty array");
        return;
      }

      socket.to(`conversation_${conversationId}`).emit("messages_read", {
        conversationId,
        userId,
        messageIds,
        timestamp: new Date().toISOString(),
      });

      TelemetryMetrics.incrementThroughput("read");
    };

    socket.on("mark_as_read", markReadHandler);
    socket.on("mark_message_read", markReadHandler);
  });
}

function registerDatabaseSocketHandlers(
  io: Server,
  replayCache: ReplayCache,
): void {
  const prisma = getPrismaClient();

  io.on("connection", (rawSocket: Socket) => {
    const socket = rawSocket as AuthenticatedSocket;
    const auth = assertAuthContext(socket);

    socket.join(`user_${auth.userId}`);

    (async () => {
      try {
        const conversations = await prisma.conversation.findMany({
          where: { conversationUsers: { some: { userId: auth.userId } } },
          select: { id: true },
        });
        conversations.forEach((conv: { id: string }) =>
          socket.join(`conversation_${conv.id}`),
        );
      } catch (error) {
        console.error("Error joining conversation rooms:", error);
      }
    })();

    socket.on("join_conversation", async (payload: any = {}) => {
      const conversationId = payload?.conversationId as string | undefined;
      if (!conversationId) {
        emitError(socket, "conversationId is required");
        return;
      }

      const userId = resolveUserId(socket, payload?.userId);
      if (!userId) {
        return;
      }

      const membership = await prisma.conversationUser.findFirst({
        where: { conversationId, userId, isActive: true },
      });

      if (!membership) {
        emitError(socket, "You are not a participant in this conversation");
        return;
      }

      socket.join(`conversation_${conversationId}`);
      socket.emit("conversation_joined", {
        conversationId,
        userId,
        joinedAt: new Date().toISOString(),
      });
      socket.to(`conversation_${conversationId}`).emit("user_joined", {
        conversationId,
        userId,
        socketId: socket.id,
        timestamp: new Date().toISOString(),
      });
    });

    socket.on("leave_conversation", async (payload: any = {}) => {
      const conversationId = payload?.conversationId as string | undefined;
      if (!conversationId) {
        emitError(socket, "conversationId is required");
        return;
      }

      const userId = resolveUserId(socket, payload?.userId);
      if (!userId) {
        return;
      }

      socket.leave(`conversation_${conversationId}`);
      socket.emit("conversation_left", {
        conversationId,
        userId,
        timestamp: new Date().toISOString(),
      });
      socket.to(`conversation_${conversationId}`).emit("user_left", {
        conversationId,
        userId,
        socketId: socket.id,
        timestamp: new Date().toISOString(),
      });
    });

    socket.on("send_message", async (payload: any = {}) => {
      const startedAt = Date.now();
      try {
        const conversationId = payload?.conversationId as string | undefined;
        const content =
          typeof payload?.content === "string" ? payload.content : "";
        const messageType =
          typeof payload?.messageType === "string"
            ? payload.messageType
            : "TEXT";
        const attachments = Array.isArray(payload?.attachments)
          ? payload.attachments
          : [];

        if (!conversationId) {
          TelemetryMetrics.incrementError("send_message");
          emitError(socket, "conversationId is required");
          return;
        }

        const userId = resolveUserId(socket, payload?.userId);
        if (!userId) {
          return;
        }

        if (!content.trim() && attachments.length === 0) {
          TelemetryMetrics.incrementError("send_message");
          emitError(socket, "Message content is required");
          return;
        }

        if (content.length > MAX_MESSAGE_LENGTH) {
          TelemetryMetrics.incrementError("send_message");
          emitError(socket, "Message content is too long");
          return;
        }

        const membership = await prisma.conversationUser.findFirst({
          where: { conversationId, userId, isActive: true },
        });

        if (!membership) {
          TelemetryMetrics.incrementError("send_message");
          emitError(socket, "You are not a participant in this conversation");
          return;
        }

        const record = await prisma.$transaction(async (tx: any) => {
          const createdMessage = await tx.message.create({
            data: {
              content,
              type: messageType,
              senderId: userId,
              conversationId,
            },
          });

          if (attachments.length) {
            await Promise.all(
              attachments.map((att: any) =>
                tx.attachment.create({
                  data: {
                    filename: att.filename || att.fileName || "file",
                    originalName:
                      att.originalName ||
                      att.originalFileName ||
                      att.filename ||
                      "file",
                    mimeType: att.mimeType || att.fileType,
                    size: att.size || att.fileSize || 0,
                    url: att.url || att.fileUrl,
                    uploaderId: userId,
                    messageId: createdMessage.id,
                  },
                }),
              ),
            );
          }

          await tx.conversation.update({
            where: { id: conversationId },
            data: {
              updatedAt: new Date(),
              lastMessageAt: new Date(),
              lastMessageId: createdMessage.id,
            },
          });

          const persisted = await tx.message.findUnique({
            where: { id: createdMessage.id },
            include: {
              sender: {
                select: {
                  id: true,
                  username: true,
                  firstName: true,
                  lastName: true,
                  profileImageUrl: true,
                  isVerified: true,
                },
              },
              attachments: true,
            },
          });

          if (!persisted) {
            return null;
          }

          const replayMessage: ReplayMessage = {
            ...persisted,
            conversationId,
            createdAt:
              persisted.createdAt instanceof Date
                ? persisted.createdAt.toISOString()
                : new Date().toISOString(),
            id: persisted.id,
          };

          await replayCache.storeMessage(replayMessage);
          return persisted;
        });

        if (!record) {
          TelemetryMetrics.incrementError("send_message");
          emitError(socket, "Failed to persist message");
          return;
        }

        const payloadMessage = {
          ...record,
          author: record.sender,
          conversationId,
        };

        socket
          .to(`conversation_${conversationId}`)
          .emit("new_message", payloadMessage);
        socket.emit("message_sent", payloadMessage);
        TelemetryMetrics.incrementThroughput("send");
        TelemetryMetrics.observeDeliveryLatency("send", Date.now() - startedAt);
        TelemetryMetrics.incrementThroughput("delivered");
      } catch (error) {
        console.error("send_message handler error:", error);
        TelemetryMetrics.incrementError("send_message");
        emitError(socket, "Failed to send message");
      }
    });

    socket.on(
      "resume_messages",
      async (payload: any = {}, callback?: (result: unknown) => void) => {
        try {
          const conversationId =
            typeof payload?.conversationId === "string"
              ? payload.conversationId
              : undefined;
          const cursor =
            typeof payload?.lastReceivedMessageId === "string"
              ? payload.lastReceivedMessageId
              : (socket.data.resumeCursor?.lastReceivedMessageId ?? null);

          if (!conversationId) {
            emitError(socket, "conversationId is required", {
              event: "resume_messages",
            });
            callback?.({ ok: false, reason: "missing_conversation" });
            return;
          }

          const membership = await prisma.conversationUser.findFirst({
            where: { conversationId, userId: auth.userId, isActive: true },
          });
          if (!membership) {
            emitError(socket, "You are not a participant in this conversation");
            callback?.({ ok: false, reason: "not_participant" });
            return;
          }

          const replayMessages = await replayCache.fetchSince(
            conversationId,
            cursor ?? undefined,
          );
          const state = ensureDeliveryState(socket);
          const filtered = filterDeduplicatedMessages(state, replayMessages);

          if (filtered.length > 0) {
            socket.emit("replayed_messages", {
              conversationId,
              messages: filtered,
              cursor,
              replayedAt: new Date().toISOString(),
            });
            TelemetryMetrics.incrementReplayCount("cache", filtered.length);
          }

          callback?.({ ok: true, replayed: filtered.length });
        } catch (error) {
          console.error("resume_messages handler error:", error);
          TelemetryMetrics.incrementError("history");
          emitError(socket, "Failed to replay messages");
          callback?.({ ok: false, reason: "internal" });
        }
      },
    );

    const typingHandler = (payload: any = {}) => {
      const conversationId = payload?.conversationId as string | undefined;
      if (!conversationId) {
        emitError(socket, "conversationId is required");
        return;
      }

      const userId = resolveUserId(socket, payload?.userId);
      if (!userId) {
        return;
      }

      socket.to(`conversation_${conversationId}`).emit("user_typing", {
        conversationId,
        userId,
        socketId: socket.id,
        isTyping: Boolean(payload?.isTyping),
        timestamp: new Date().toISOString(),
      });
    };

    socket.on("typing_indicator", typingHandler);
    socket.on("typing_start", (payload: any = {}) =>
      typingHandler({ ...payload, isTyping: true }),
    );
    socket.on("typing_stop", (payload: any = {}) =>
      typingHandler({ ...payload, isTyping: false }),
    );

    const markAsReadHandler = async (payload: any = {}) => {
      try {
        const conversationId = payload?.conversationId as string | undefined;
        const messageIds = Array.isArray(payload?.messageIds)
          ? payload.messageIds
          : undefined;

        if (!conversationId) {
          TelemetryMetrics.incrementError("read");
          emitError(socket, "conversationId is required");
          return;
        }

        const userId = resolveUserId(socket, payload?.userId);
        if (!userId) {
          return;
        }

        if (!messageIds || messageIds.length === 0) {
          TelemetryMetrics.incrementError("read");
          emitError(socket, "messageIds must be a non-empty array");
          return;
        }

        await prisma.$transaction(async (tx: any) => {
          await Promise.all(
            messageIds.map((messageId: string) =>
              tx.messageRead.upsert({
                where: {
                  messageId_userId: {
                    messageId,
                    userId,
                  },
                },
                update: { readAt: new Date() },
                create: {
                  messageId,
                  userId,
                  readAt: new Date(),
                },
              }),
            ),
          );
        });

        socket.to(`conversation_${conversationId}`).emit("messages_read", {
          conversationId,
          userId,
          messageIds,
          timestamp: new Date().toISOString(),
        });

        TelemetryMetrics.incrementThroughput("read");
      } catch (error) {
        console.error("mark_as_read error:", error);
        TelemetryMetrics.incrementError("read");
        emitError(socket, "Failed to mark messages as read");
      }
    };

    socket.on("mark_as_read", markAsReadHandler);
    socket.on("mark_message_read", markAsReadHandler);
  });
}

interface RegisterSocketOptions {
  readonly realtime?: EnvironmentConfig["realtime"];
}

export async function registerSocketHandlers(
  io: Server,
  options: RegisterSocketOptions = {},
): Promise<void> {
  const env = getEnv();
  const verifier = new TokenVerifier(env.auth);

  const realtimeConfig = options.realtime ?? env.realtime;

  const pingInterval = realtimeConfig.heartbeatIntervalMs;
  const pingTimeout =
    realtimeConfig.heartbeatIntervalMs + realtimeConfig.heartbeatGraceMs;

  if (io.engine && io.engine.opts) {
    io.engine.opts.pingInterval = pingInterval;
    io.engine.opts.pingTimeout = pingTimeout;
  }

  // Align top-level options as well for introspection/middleware compatibility.
  (
    io as unknown as { opts?: { pingInterval?: number; pingTimeout?: number } }
  ).opts = {
    ...(
      io as unknown as {
        opts?: { pingInterval?: number; pingTimeout?: number };
      }
    ).opts,
    pingInterval,
    pingTimeout,
  };

  StructuredLogger.info("socket.heartbeat.config", {
    status: "applied",
    data: {
      pingIntervalMs: pingInterval,
      graceWindowMs: realtimeConfig.heartbeatGraceMs,
      pingTimeoutMs: pingTimeout,
    },
  });

  if (realtimeConfig.adapterEnabled) {
    await initializeSocketRedisAdapter(io, realtimeConfig);
  }

  const presenceRegistry = realtimeConfig.redisUrl
    ? await PresenceRegistry.create(realtimeConfig)
    : null;

  const replayCache = await createReplayCache(realtimeConfig);

  registerHandshakeGuard(io, verifier);
  registerLifecycleInstrumentation(io, {
    presenceRegistry,
    heartbeatIntervalMs: realtimeConfig.heartbeatIntervalMs,
    dedupeLimit: realtimeConfig.replayCacheMaxMessages ?? DEFAULT_DEDUPE_LIMIT,
  });

  if (env.flags.mockMode || isMockPrismaMode) {
    registerMockSocketHandlers(io);
  } else {
    registerDatabaseSocketHandlers(io, replayCache);
  }
}
