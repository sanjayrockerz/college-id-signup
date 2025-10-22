import fs from "fs";
import path from "path";
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { Server } from "socket.io";
import { io as Client, Socket } from "socket.io-client";
import { AddressInfo } from "net";

process.env.PRISMA_CLIENT_MODE = process.env.PRISMA_CLIENT_MODE || "mock";

const Module = require("module");
const originalJsLoader = Module._extensions[".js"];
const tsLoader = Module._extensions[".ts"];
const srcDir = path.resolve(__dirname, "../src");

if (typeof tsLoader === "function") {
  Module._extensions[".js"] = function hybridLoader(
    module: NodeModule,
    filename: string,
  ) {
    if (
      filename.startsWith(srcDir) &&
      !fs.existsSync(filename) &&
      fs.existsSync(`${filename.slice(0, -3)}.ts`)
    ) {
      return tsLoader(module, `${filename.slice(0, -3)}.ts`);
    }

    if (
      filename.startsWith(srcDir) &&
      fs.existsSync(`${filename.slice(0, -3)}.ts`)
    ) {
      return tsLoader(module, `${filename.slice(0, -3)}.ts`);
    }

    return originalJsLoader(module, filename);
  };
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { registerSocketHandlers } from "../src/socket/handlers";

interface SmokeResult {
  name: string;
  description: string;
  type: "rest" | "socket";
  status: "pass" | "fail";
  latencyMs: number | null;
  statusCode?: number;
  responseBody?: any;
  error?: string;
}

interface SmokeSuiteResult {
  results: SmokeResult[];
  metrics: {
    total: number;
    passed: number;
    failed: number;
    passRate: number;
    avgLatencyMs: number | null;
    p95LatencyMs: number | null;
    p99LatencyMs: number | null;
    errorRate: number;
  };
}

function diffMs(start: bigint, end: bigint): number {
  return Number(end - start) / 1_000_000;
}

function computeLatencyMetrics(samples: number[]): {
  avg: number | null;
  p95: number | null;
  p99: number | null;
} {
  if (!samples.length) {
    return { avg: null, p95: null, p99: null };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const avg = sorted.reduce((acc, val) => acc + val, 0) / sorted.length;
  const p95Index = Math.min(
    sorted.length - 1,
    Math.floor(0.95 * sorted.length) - 1,
  );
  const p99Index = Math.min(
    sorted.length - 1,
    Math.floor(0.99 * sorted.length) - 1,
  );
  return {
    avg,
    p95: sorted[Math.max(0, p95Index)],
    p99: sorted[Math.max(0, p99Index)],
  };
}

async function runSmokeTests(): Promise<void> {
  const { AppModule } = require("../src/app.module.ts");
  const { configureApp } = require("../src/app.bootstrap.ts");

  const results: SmokeResult[] = [];
  let app: INestApplication | null = null;
  let ioServer: Server | null = null;
  const latencySamples: number[] = [];

  const recordResult = (result: SmokeResult) => {
    results.push(result);
    if (result.status === "pass" && typeof result.latencyMs === "number") {
      latencySamples.push(result.latencyMs);
    }
  };

  const runRestScenario = async (
    name: string,
    description: string,
    execute: () => Promise<{ statusCode: number; body: any; ok: boolean }>,
  ): Promise<void> => {
    const start = process.hrtime.bigint();
    try {
      const { statusCode, body, ok } = await execute();
      const latency = diffMs(start, process.hrtime.bigint());
      recordResult({
        name,
        description,
        type: "rest",
        status: ok ? "pass" : "fail",
        latencyMs: latency,
        statusCode,
        responseBody: body,
        error: ok ? undefined : "Scenario validation failed",
      });
    } catch (error: any) {
      const latency = diffMs(start, process.hrtime.bigint());
      recordResult({
        name,
        description,
        type: "rest",
        status: "fail",
        latencyMs: latency,
        error: error?.message || String(error),
      });
      throw error;
    }
  };

  const runSocketScenario = async (
    name: string,
    description: string,
    execute: () => Promise<boolean>,
  ): Promise<void> => {
    const start = process.hrtime.bigint();
    try {
      const ok = await execute();
      const latency = diffMs(start, process.hrtime.bigint());
      recordResult({
        name,
        description,
        type: "socket",
        status: ok ? "pass" : "fail",
        latencyMs: latency,
        error: ok ? undefined : "Scenario validation failed",
      });
    } catch (error: any) {
      const latency = diffMs(start, process.hrtime.bigint());
      recordResult({
        name,
        description,
        type: "socket",
        status: "fail",
        latencyMs: latency,
        error: error?.message || String(error),
      });
      throw error;
    }
  };

  try {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await configureApp(app);
    await app.listen(0);

    const httpServer = app.getHttpServer();
    const address = httpServer.address() as AddressInfo;
    const serverUrl = `http://127.0.0.1:${address.port}`;

    ioServer = new Server(httpServer, {
      cors: {
        origin: process.env.CORS_ORIGIN?.split(",") ?? [
          "http://localhost:3000",
        ],
        credentials: true,
      },
      transports: ["websocket", "polling"],
    });

    registerSocketHandlers(ioServer);

    const restAgent = request(serverUrl);

    const restContext: {
      conversationId?: string;
      messageId?: string;
    } = {};

    await runRestScenario(
      "REST: Health Check",
      "GET /api/v1/health",
      async () => {
        const response = await restAgent.get("/api/v1/health").expect(200);
        return {
          statusCode: response.status,
          body: response.body,
          ok: response.body?.status === "ok",
        };
      },
    );

    await runRestScenario(
      "REST: Create Conversation",
      "POST /api/v1/chat/conversations",
      async () => {
        const response = await restAgent
          .post("/api/v1/chat/conversations")
          .send({
            userId: "smoke-user-1",
            type: "DIRECT",
            participantIds: ["smoke-user-2"],
          });
        const ok =
          response.status === 201 && Boolean(response.body?.conversation?.id);
        if (ok) {
          restContext.conversationId = response.body.conversation.id;
        }
        return { statusCode: response.status, body: response.body, ok };
      },
    );

    await runRestScenario(
      "REST: Send Message",
      "POST /api/v1/chat/conversations/:id/messages",
      async () => {
        if (!restContext.conversationId) {
          throw new Error("conversationId not set");
        }
        const response = await restAgent
          .post(
            `/api/v1/chat/conversations/${restContext.conversationId}/messages`,
          )
          .send({
            userId: "smoke-user-1",
            content: "smoke-test-message",
            messageType: "TEXT",
          });
        const ok =
          response.status === 201 &&
          response.body?.message?.content === "smoke-test-message";
        if (ok) {
          restContext.messageId = response.body.message.id;
        }
        return { statusCode: response.status, body: response.body, ok };
      },
    );

    await runRestScenario(
      "REST: Fetch History",
      "GET /api/v1/chat/conversations/:id/messages",
      async () => {
        if (!restContext.conversationId) {
          throw new Error("conversationId not set");
        }
        const response = await restAgent
          .get(
            `/api/v1/chat/conversations/${restContext.conversationId}/messages`,
          )
          .query({ userId: "smoke-user-1", limit: 20 });
        const ok =
          response.status === 200 &&
          Array.isArray(response.body?.data?.messages);
        return { statusCode: response.status, body: response.body, ok };
      },
    );

    await runRestScenario(
      "REST: Invalid Payload",
      "POST /api/v1/chat/conversations/:id/messages with oversized content",
      async () => {
        if (!restContext.conversationId) {
          throw new Error("conversationId not set");
        }
        const response = await restAgent
          .post(
            `/api/v1/chat/conversations/${restContext.conversationId}/messages`,
          )
          .send({
            userId: "smoke-user-1",
            content: "x".repeat(10_500),
            messageType: "TEXT",
          });
        const ok = response.status === 400 || response.status === 413;
        return { statusCode: response.status, body: response.body, ok };
      },
    );

    let clientA: Socket | null = null;
    let clientB: Socket | null = null;

    const createClient = (userId: string) =>
      Client(serverUrl, {
        transports: ["websocket"],
        reconnection: false,
        query: { userId },
      });

    await runSocketScenario(
      "Socket: Connect",
      "Establish connection",
      async () => {
        clientA = createClient("socket-smoke-1");
        clientB = createClient("socket-smoke-2");

        await Promise.all([
          new Promise<void>((resolve, reject) => {
            clientA?.once("connect", resolve);
            clientA?.once("connect_error", reject);
            setTimeout(
              () => reject(new Error("socket A connect timeout")),
              5000,
            );
          }),
          new Promise<void>((resolve, reject) => {
            clientB?.once("connect", resolve);
            clientB?.once("connect_error", reject);
            setTimeout(
              () => reject(new Error("socket B connect timeout")),
              5000,
            );
          }),
        ]);

        return true;
      },
    );

    await runSocketScenario(
      "Socket: Join Room",
      "join_conversation event",
      async () => {
        if (!clientA || !clientB || !restContext.conversationId) {
          throw new Error("socket clients or conversation not available");
        }

        const joinedA = new Promise<void>((resolve, reject) => {
          clientA?.emit("join_conversation", {
            conversationId: restContext.conversationId,
            userId: "socket-smoke-1",
          });
          clientA?.once("conversation_joined", () => resolve());
          clientA?.once("conversation_error", (err) =>
            reject(new Error(err?.error || "join error")),
          );
          setTimeout(() => reject(new Error("socket A join timeout")), 5000);
        });

        const joinedB = new Promise<void>((resolve, reject) => {
          clientB?.emit("join_conversation", {
            conversationId: restContext.conversationId,
            userId: "socket-smoke-2",
          });
          clientB?.once("conversation_joined", () => resolve());
          clientB?.once("conversation_error", (err) =>
            reject(new Error(err?.error || "join error")),
          );
          setTimeout(() => reject(new Error("socket B join timeout")), 5000);
        });

        await Promise.all([joinedA, joinedB]);
        return true;
      },
    );

    await runSocketScenario(
      "Socket: Send & Receive",
      "Emit send_message and receive new_message",
      async () => {
        if (!clientA || !clientB || !restContext.conversationId) {
          throw new Error("socket clients or conversation not available");
        }

        const messagePromise = new Promise<boolean>((resolve, reject) => {
          clientB?.once("new_message", (payload) => {
            resolve(payload?.content === "socket smoke message");
          });
          clientB?.once("message_error", (err) =>
            reject(new Error(err?.error || "message error")),
          );
          setTimeout(() => reject(new Error("message receive timeout")), 5000);
        });

        clientA.emit("send_message", {
          conversationId: restContext.conversationId,
          userId: "socket-smoke-1",
          content: "socket smoke message",
          messageType: "TEXT",
        });

        return await messagePromise;
      },
    );

    await runSocketScenario(
      "Socket: Reconnect",
      "Disconnect and reconnect while retaining room access",
      async () => {
        if (!clientA || !clientB || !restContext.conversationId) {
          throw new Error("socket clients or conversation not available");
        }

        clientA.disconnect();

        await new Promise<void>((resolve) => {
          clientA?.once("disconnect", () => resolve());
          setTimeout(() => resolve(), 500);
        });

        clientA = createClient("socket-smoke-1");

        await new Promise<void>((resolve, reject) => {
          clientA?.once("connect", () => resolve());
          clientA?.once("connect_error", reject);
          setTimeout(() => reject(new Error("socket reconnect timeout")), 5000);
        });

        await new Promise<void>((resolve, reject) => {
          clientA?.emit("join_conversation", {
            conversationId: restContext.conversationId,
            userId: "socket-smoke-1",
          });
          clientA?.once("conversation_joined", () => resolve());
          clientA?.once("conversation_error", (err) =>
            reject(new Error(err?.error || "join error")),
          );
          setTimeout(() => reject(new Error("rejoin timeout")), 5000);
        });

        const messagePromise = new Promise<boolean>((resolve, reject) => {
          clientB?.once("new_message", (payload) => {
            resolve(payload?.content === "reconnected message");
          });
          clientB?.once("message_error", (err) =>
            reject(new Error(err?.error || "message error")),
          );
          setTimeout(
            () => reject(new Error("post-reconnect receive timeout")),
            5000,
          );
        });

        clientA.emit("send_message", {
          conversationId: restContext.conversationId,
          userId: "socket-smoke-1",
          content: "reconnected message",
          messageType: "TEXT",
        });

        return await messagePromise;
      },
    );

    await runRestScenario(
      "REST: Rate Limit",
      "Send 101 rapid requests and expect 429",
      async () => {
        const responses: number[] = [];
        for (let i = 0; i < 101; i += 1) {
          const response = await restAgent
            .post("/api/v1/chat/conversations")
            .send({
              userId: "rate-limit-user",
              type: "DIRECT",
              participantIds: ["rate-limit-target"],
            });
          responses.push(response.status);
        }
        const lastStatus = responses[responses.length - 1];
        const ok = lastStatus === 429;
        return { statusCode: lastStatus, body: { allStatuses: responses }, ok };
      },
    );

    const { avg, p95, p99 } = computeLatencyMetrics(latencySamples);
    const passed = results.filter((r) => r.status === "pass").length;
    const failed = results.length - passed;

    const suiteResult: SmokeSuiteResult = {
      results,
      metrics: {
        total: results.length,
        passed,
        failed,
        passRate: results.length ? (passed / results.length) * 100 : 0,
        avgLatencyMs: avg,
        p95LatencyMs: p95,
        p99LatencyMs: p99,
        errorRate: results.length ? (failed / results.length) * 100 : 0,
      },
    };

    const fs = await import("fs/promises");
    const outputPath = `${process.cwd()}/docs/validation/smoke-test-results.json`;
    await fs.writeFile(
      outputPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          environment: {
            prismaMockMode: process.env.PRISMA_CLIENT_MODE === "mock",
          },
          suite: suiteResult,
        },
        null,
        2,
      ),
      "utf8",
    );
    // eslint-disable-next-line no-console
    console.log(`Smoke test results written to ${outputPath}`);

    if (failed > 0) {
      throw new Error("Smoke tests reported failures");
    }
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 200));
    try {
      await ioServer?.close();
    } catch (error) {
      // no-op
    }
    try {
      await app?.close();
    } catch (error) {
      // no-op
    }
  }
}

runSmokeTests().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Smoke tests failed:", error);
  process.exitCode = 1;
});
