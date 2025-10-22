import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import { Emitter } from "@socket.io/redis-emitter";

interface EmitOptions {
  readonly rooms?: string[];
}

@Injectable()
export class SocketEmitterService implements OnModuleDestroy {
  private readonly logger = new Logger(SocketEmitterService.name);
  private readonly redis: Redis;
  private readonly emitter: Emitter;

  constructor() {
    const host = process.env.REDIS_HOST || "localhost";
    const port = parseInt(process.env.REDIS_PORT || "6379", 10);
    const password = process.env.REDIS_PASSWORD;
    const db = parseInt(
      process.env.REDIS_SOCKET_DB || process.env.REDIS_STREAM_DB || "1",
      10,
    );

    this.redis = new Redis({
      host,
      port,
      password,
      db,
      retryStrategy: (attempt) => Math.min(attempt * 50, 2000),
      maxRetriesPerRequest: 5,
    });

    this.emitter = new Emitter(this.redis, {
      key: process.env.SOCKET_REDIS_KEY || "socket.io",
    });
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch (error) {
      this.logger.warn(
        "Failed to close Socket.IO emitter redis connection",
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Emit payload to a specific socket.
   */
  async emitToSocket(
    socketId: string,
    event: string,
    payload: unknown,
  ): Promise<void> {
    try {
      this.emitter.to(socketId).emit(event, payload);
    } catch (error) {
      this.logger.error(
        `Failed to emit event ${event} to socket ${socketId}`,
        error instanceof Error ? error : undefined,
      );
      throw error;
    }
  }

  /**
   * Emit payload to multiple sockets (rooms).
   */
  async emitToSockets(
    socketIds: string[],
    event: string,
    payload: unknown,
  ): Promise<void> {
    if (socketIds.length === 0) {
      return;
    }

    try {
      this.emitter.to(socketIds).emit(event, payload);
    } catch (error) {
      this.logger.error(
        `Failed to emit event ${event} to sockets`,
        error instanceof Error ? error : undefined,
      );
      throw error;
    }
  }

  /**
   * Emit payload to user-specific room.
   */
  async emitToUserRoom(
    userId: string,
    event: string,
    payload: unknown,
    options: EmitOptions = {},
  ): Promise<void> {
    const rooms = new Set<string>([`user_${userId}`]);
    (options.rooms ?? []).forEach((room) => rooms.add(room));

    try {
      this.emitter.to(Array.from(rooms)).emit(event, payload);
    } catch (error) {
      this.logger.error(
        `Failed to emit event ${event} to user ${userId}`,
        error instanceof Error ? error : undefined,
      );
      throw error;
    }
  }
}
