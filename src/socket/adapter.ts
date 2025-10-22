import { createAdapter } from "@socket.io/redis-adapter";
import type { Server } from "socket.io";
import type { EnvironmentConfig } from "../config/environment";
import { getRedisClients } from "../realtime/redis-manager";
import { TelemetryMetrics } from "../observability/metrics-registry";
import { StructuredLogger } from "../common/logging/structured-logger";

type RealtimeConfig = EnvironmentConfig["realtime"];

const ADAPTER_READY_FLAG = Symbol.for("chat.adapter.ready");
const ADAPTER_ERROR_FLAG = Symbol("chat.adapter.error_listener");

export async function initializeSocketRedisAdapter(
  io: Server,
  config: RealtimeConfig,
): Promise<void> {
  if (Reflect.get(io as object, ADAPTER_READY_FLAG)) {
    return;
  }

  try {
    const { pubClient, subClient } = await getRedisClients(config);
    io.adapter(createAdapter(pubClient, subClient));
    attachAdapterErrorListener(io, config.instanceId);
    Reflect.set(io as object, ADAPTER_READY_FLAG, true);
    TelemetryMetrics.recordAdapterConnect("adapter_ready");
  } catch (error) {
    TelemetryMetrics.recordAdapterError("adapter_init_failure");
    StructuredLogger.error("socket.adapter.init", {
      status: "failed",
      data: {
        instanceId: config.instanceId,
      },
      error: {
        code: "redis.adapter_init_failure",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    throw error;
  }
}

function attachAdapterErrorListener(io: Server, instanceId: string): void {
  const adapter = io.of("/").adapter as unknown as {
    on?: (event: string, listener: (...args: unknown[]) => void) => void;
    [ADAPTER_ERROR_FLAG]?: boolean;
  };

  if (!adapter || typeof adapter.on !== "function") {
    return;
  }

  if (Reflect.get(adapter as object, ADAPTER_ERROR_FLAG)) {
    return;
  }

  adapter.on("error", (error: unknown) => {
    TelemetryMetrics.recordAdapterError("adapter_error_event");
    StructuredLogger.warn("socket.adapter.error", {
      status: "error",
      data: {
        instanceId,
      },
      error: {
        code: "redis.adapter_error",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
  });

  Reflect.set(adapter as object, ADAPTER_ERROR_FLAG, true);
}
