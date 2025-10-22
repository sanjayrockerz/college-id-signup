import { EventEmitter } from "events";
import { createSecretKey, type KeyObject } from "crypto";
import { SignJWT, type JWTPayload } from "jose";
import {
  loadEnvironment,
  resetEnvironmentCacheForTests,
} from "../../../src/config/environment";

interface HandshakeState {
  auth: Record<string, unknown>;
  query: Record<string, unknown>;
  headers: Record<string, string>;
  address: string;
}

export interface MockSocketInit {
  userId?: string;
  token?: string;
  handshake?: Partial<HandshakeState>;
}

export interface ConnectOptions {
  userId: string;
  token?: string | null;
  handshake?: Partial<HandshakeState>;
}

const TEST_SHARED_SECRET = "socket-unit-secret";

let sharedSecretKey: KeyObject | null = null;
let envInitialized = false;

export function initializeSocketTestEnvironment(): void {
  if (envInitialized) {
    return;
  }

  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  process.env.JWT_ISSUER =
    process.env.JWT_ISSUER ?? "https://issuer.example.com";
  process.env.JWT_AUDIENCE = process.env.JWT_AUDIENCE ?? "chat-backend";
  process.env.PUBLIC_KEYS = TEST_SHARED_SECRET;
  process.env.TOKEN_LEEWAY_SEC = process.env.TOKEN_LEEWAY_SEC ?? "5";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ??
    "postgresql://user:pass@localhost:5432/chat_test";

  resetEnvironmentCacheForTests();
  loadEnvironment();

  sharedSecretKey = createSecretKey(Buffer.from(TEST_SHARED_SECRET, "utf-8"));
  envInitialized = true;
}

export async function signTestToken(
  userId: string,
  overrides: Partial<JWTPayload> = {},
): Promise<string> {
  if (!envInitialized || sharedSecretKey === null) {
    initializeSocketTestEnvironment();
  }

  return new SignJWT({ sub: userId, ...overrides })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(process.env.JWT_ISSUER!)
    .setAudience(process.env.JWT_AUDIENCE!)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(sharedSecretKey as KeyObject);
}

export class MockSocket extends EventEmitter {
  id: string;
  handshake: HandshakeState;
  userId?: string;
  data: {
    authContext?: {
      userId: string;
      tokenClaims: JWTPayload;
      client: {
        ip?: string;
        userAgent?: string;
        appVersion?: string;
        platform?: string;
      };
    };
    connectedAt?: number;
  } = {};
  private handlers: Record<string, (...args: any[]) => any> = {};
  rooms: Set<string> = new Set();
  readonly broadcastEmit = jest.fn();

  constructor({ userId, token, handshake }: MockSocketInit = {}) {
    super();
    this.id = `socket-${Math.random().toString(36).slice(2)}`;
    this.userId = userId;

    const defaultHandshake: HandshakeState = {
      auth: token ? { token } : {},
      query: {},
      headers: {},
      address: "127.0.0.1",
    };

    this.handshake = {
      ...defaultHandshake,
      ...(handshake ?? {}),
      auth: {
        ...defaultHandshake.auth,
        ...(handshake?.auth ?? {}),
      },
      query: {
        ...defaultHandshake.query,
        ...(handshake?.query ?? {}),
      },
      headers: {
        ...defaultHandshake.headers,
        ...(handshake?.headers ?? {}),
      },
    };
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

export class MockIo {
  private connectionHandlers: ((socket: MockSocket) => void)[] = [];
  private middlewares: ((
    socket: MockSocket,
    next: (err?: Error) => void,
  ) => void)[] = [];

  on(event: string, handler: (socket: MockSocket) => void) {
    if (event === "connection") {
      this.connectionHandlers.push(handler);
    }
  }

  use(middleware: (socket: MockSocket, next: (err?: Error) => void) => void) {
    this.middlewares.push(middleware);
    return this;
  }

  async connect({
    userId,
    token,
    handshake,
  }: ConnectOptions): Promise<MockSocket> {
    const resolvedToken =
      token === undefined ? await signTestToken(userId) : (token ?? undefined);

    const socket = new MockSocket({ userId, token: resolvedToken, handshake });

    for (const middleware of this.middlewares) {
      await new Promise<void>((resolve, reject) => {
        middleware(socket, (err?: Error) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }

    this.connectionHandlers.forEach((handler) => handler(socket));
    return socket;
  }
}
