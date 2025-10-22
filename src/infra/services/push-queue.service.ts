import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import { PushTask } from "./push-task.interface";

interface EnqueueResult {
  readonly streamId: string;
}

@Injectable()
export class PushQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(PushQueueService.name);
  private readonly redis: Redis;
  private readonly streamKey: string;
  private readonly consumerGroup: string;

  constructor() {
    const host = process.env.REDIS_HOST || "localhost";
    const port = parseInt(process.env.REDIS_PORT || "6379", 10);
    const password = process.env.REDIS_PASSWORD;
    const db = parseInt(
      process.env.REDIS_PUSH_DB || process.env.REDIS_STREAM_DB || "1",
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

    this.streamKey = process.env.PUSH_STREAM_KEY || "push:notifications";
    this.consumerGroup = process.env.PUSH_CONSUMER_GROUP || "push-workers";

    void this.ensureConsumerGroup().catch((error) => {
      this.logger.warn(
        "Failed to ensure push consumer group on bootstrap",
        error instanceof Error ? error : undefined,
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch (error) {
      this.logger.warn(
        "Failed to close push queue redis connection",
        error instanceof Error ? error : undefined,
      );
    }
  }

  private async ensureConsumerGroup(): Promise<void> {
    try {
      await this.redis.xgroup(
        "CREATE",
        this.streamKey,
        this.consumerGroup,
        "0",
        "MKSTREAM",
      );
    } catch (error: any) {
      if (
        typeof error?.message === "string" &&
        error.message.includes("BUSYGROUP")
      ) {
        return;
      }
      this.logger.warn(
        "Failed to create push consumer group",
        error instanceof Error ? error : undefined,
      );
    }
  }

  async enqueue(task: PushTask): Promise<EnqueueResult> {
    try {
      const streamId = await this.redis.xadd(
        this.streamKey,
        "*",
        "task",
        JSON.stringify(task),
      );
      return { streamId };
    } catch (error) {
      this.logger.error(
        "Failed to enqueue push task",
        error instanceof Error ? error : undefined,
      );
      throw error;
    }
  }
}
