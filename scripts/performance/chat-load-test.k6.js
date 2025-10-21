import http from "k6/http";
import exec from "k6/execution";
import { check, sleep } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";

const BASE_URL = __ENV.CHAT_BASE_URL || "http://localhost:3000/api/v1/chat";
const CONVERSATION_IDS = (__ENV.CONVERSATION_IDS || "mock-conv-1,mock-conv-2,mock-conv-3")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const USERS = (__ENV.USER_IDS || "load-user-1,load-user-2,load-user-3,load-user-4")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const HISTORY_LIMIT = Number(__ENV.HISTORY_LIMIT || 20);
const SEND_RATIO = Number(__ENV.SEND_RATIO || 0.7);
const MAX_CONTENT_LENGTH = Number(__ENV.MAX_CONTENT_LENGTH || 220);

const latencySend = new Trend("latency_send", true);
const latencyHistory = new Trend("latency_history", true);
const sendErrorRate = new Rate("send_error_rate");
const historyErrorRate = new Rate("history_error_rate");
const sendStatusCounter = new Counter("send_status_total");
const historyStatusCounter = new Counter("history_status_total");

function randomUser() {
  return USERS[Math.floor(Math.random() * USERS.length)] || "load-user-fallback";
}

function randomConversation() {
  return CONVERSATION_IDS[Math.floor(Math.random() * CONVERSATION_IDS.length)] || "mock-conv-1";
}

function randomContent() {
  const length = Math.max(32, Math.floor(Math.random() * MAX_CONTENT_LENGTH));
  const base = "Lorem ipsum dolor sit amet consectetur adipiscing elit";
  const repeats = Math.ceil(length / base.length);
  return Array.from({ length: repeats }, () => base).join(" ").slice(0, length);
}

function sendMessage() {
  const conversationId = randomConversation();
  const userId = randomUser();
  const payload = JSON.stringify({
    userId,
    content: randomContent(),
    messageType: "TEXT",
  });

  const start = Date.now();
  const res = http.post(`${BASE_URL}/conversations/${conversationId}/messages`, payload, {
    headers: { "Content-Type": "application/json" },
    tags: { operation: "send" },
  });

  const latency = Date.now() - start;
  latencySend.add(latency);
  sendStatusCounter.add(1, { status: res.status });

  const ok = check(res, {
    "send status ok": (r) => r.status >= 200 && r.status < 400,
    "send latency p95 target": () => latency < 250,
    "send latency p99 target": () => latency < 500,
  });

  sendErrorRate.add(!ok);
  return res;
}

function fetchHistory() {
  const conversationId = randomConversation();
  const userId = randomUser();
  // Cursor parameter removed for load testing (was causing 400 errors with invalid Date.now() values)
  // TODO: Implement proper cursor-based pagination with real message IDs in separate test

  const start = Date.now();
  const res = http.get(
    `${BASE_URL}/conversations/${conversationId}/messages?userId=${userId}&limit=${HISTORY_LIMIT}`,
    { tags: { operation: "history" } },
  );

  const latency = Date.now() - start;
  latencyHistory.add(latency);
  historyStatusCounter.add(1, { status: res.status });

  const ok = check(res, {
    "history status ok": (r) => r.status >= 200 && r.status < 400,
    "history latency p95 target": () => latency < 350,
    "history latency p99 target": () => latency < 600,
  });

  historyErrorRate.add(!ok);
  return res;
}

export const options = {
  scenarios: {
    default: {
      executor: "ramping-arrival-rate",
      startRate: 0,
      timeUnit: "1s",
      preAllocatedVUs: Number(__ENV.K6_PRE_ALLOCATED_VUS || 120),
      maxVUs: Number(__ENV.K6_MAX_VUS || 200),
      stages: [
        { target: 50, duration: "2m" },
        { target: 50, duration: "5m" },
        { target: 100, duration: "30s" },
        { target: 100, duration: "5m" },
        { target: 0, duration: "2m" },
      ],
    },
  },
  thresholds: {
    latency_send: [
      { threshold: "p(50)<150", abortOnFail: false },
      { threshold: "p(95)<250", abortOnFail: true },
      { threshold: "p(99)<500", abortOnFail: true },
    ],
    latency_history: [
      { threshold: "p(50)<200", abortOnFail: false },
      { threshold: "p(95)<350", abortOnFail: true },
      { threshold: "p(99)<600", abortOnFail: true },
    ],
    send_error_rate: ["rate<0.01"],
    history_error_rate: ["rate<0.01"],
  },
  summaryTrendStats: ["avg", "min", "med", "p(75)", "p(90)", "p(95)", "p(99)", "max"],
};

export default function () {
  const operation = Math.random() < SEND_RATIO ? "send" : "history";

  if (operation === "send") {
    sendMessage();
  } else {
    fetchHistory();
  }

  sleep(Number(__ENV.THINK_TIME || 0.5));
}

export function handleSummary(data) {
  const outputPath = __ENV.METRICS_JSON || "docs/validation/performance-metrics.json";
  const payload = JSON.stringify(
    {
      metadata: {
        generatedAt: new Date().toISOString(),
        vusPeak: data.metrics["vus_max"]?.values?.max ?? null,
        requests: data.metrics["http_reqs"]?.values?.count ?? null,
        testDuration: data.state.testRunDurationMs,
      },
      k6: data,
    },
    null,
    2,
  );

  if (typeof outputPath === "string") {
    console.log(`Writing load test summary to ${outputPath}`);
  }

  return {
    [outputPath]: payload,
    stdout: payload,
  };
}
