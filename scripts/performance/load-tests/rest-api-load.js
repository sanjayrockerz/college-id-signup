// k6 load test for chat backend REST API covering send message and history retrieval flows.
// Run with: BASE_URL=https://staging.example.com VU_COUNT=80 TEST_DURATION=15m \
//   k6 run scripts/performance/load-tests/rest-api-load.js

import http from "k6/http";
import { check, sleep } from "k6";

const DEFAULT_BASE_URL = "http://localhost:3001/api/v1";
const BASE_URL = (__ENV.BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
const SEND_ENDPOINT = `${BASE_URL}/chat/conversations`;
const HISTORY_ENDPOINT = `${BASE_URL}/chat/conversations`;

const DEFAULT_VUS = 100;
const DEFAULT_DURATION = "14m30s";
const TARGET_VUS = Math.max(1, Number(__ENV.VU_COUNT || DEFAULT_VUS));
const TEST_DURATION = __ENV.TEST_DURATION || DEFAULT_DURATION;

const STAGES = [
  { duration: "2m", target: 50 },
  { duration: "5m", target: 50 },
  { duration: "30s", target: 100 },
  { duration: "5m", target: 100 },
  { duration: "2m", target: 0 },
];

export const options = {
  stages: STAGES,
  thresholds: {
    "http_req_duration{endpoint:send}": ["p(95)<250", "p(99)<500"],
    "http_req_duration{endpoint:history}": ["p(95)<350", "p(99)<600"],
    http_req_failed: ["rate<0.01"],
    http_reqs: ["rate>100"],
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

function safeJson(response) {
  try {
    return response.json();
  } catch (error) {
    console.error(
      `JSON parse failure for status ${response.status}: ${error && error.message ? error.message : error}`,
    );
    return null;
  }
}

function randomBetween(minSeconds, maxSeconds) {
  return Math.random() * (maxSeconds - minSeconds) + minSeconds;
}

export function setup() {
  const configuredIds = (__ENV.CONVERSATION_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const conversationIds = [...configuredIds];

  if (conversationIds.length >= 5) {
    console.log(`Using ${conversationIds.length} conversation IDs from CONVERSATION_IDS env variable.`);
    return { conversationIds };
  }

  const desiredCount = 5;
  for (let i = 0; i < desiredCount; i += 1) {
    const payload = JSON.stringify({
      userId: `performance-user-${Date.now()}-${i}`,
      type: "DIRECT",
      participantIds: [`performance-peer-${i}`],
    });

    try {
      const response = http.post(`${BASE_URL}/conversations`, payload, {
        headers: { "Content-Type": "application/json" },
        tags: { endpoint: "setup" },
      });
      const body = safeJson(response);
      const ok =
        check(response, {
          "setup: status 201": (res) => res.status === 201,
          "setup: conversation id present": () => Boolean(body && body.conversation && body.conversation.id),
        }) || false;

      if (!ok) {
        console.error(
          `Conversation setup failed (status ${response.status}) body: ${response.body || "<empty>"}`,
        );
        break;
      }
      conversationIds.push(body.conversation.id);
    } catch (error) {
      console.error(`Conversation setup error: ${String(error)}`);
      break;
    }
  }

  if (conversationIds.length === 0) {
    throw new Error(
      "No conversation IDs available. Provide CONVERSATION_IDS env or ensure POST /conversations is functional.",
    );
  }

  console.log(`Setup complete with ${conversationIds.length} conversation IDs.`);
  return { conversationIds };
}

export default function scenario(data) {
  const { conversationIds } = data;
  if (!conversationIds || conversationIds.length === 0) {
    throw new Error("conversationIds missing from setup data.");
  }

  const conversationId = conversationIds[Math.floor(Math.random() * conversationIds.length)];
  const vuId = __VU;
  const iterationId = __ITER;

  // Send message
  const sendPayload = JSON.stringify({
    userId: `loadtest-user-${vuId}`,
    content: `Load test message from VU ${vuId} iteration ${iterationId}`,
  });

  const sendResponse = http.post(`${BASE_URL}/chat/conversations/${conversationId}/messages`, sendPayload, {
    headers: { "Content-Type": "application/json" },
    tags: { endpoint: "send" },
  });

  check(sendResponse, {
    "send: status 201": (res) => res.status === 201,
    "send: has message id": (res) => {
      const body = safeJson(res);
      return Boolean(body && body.id);
    },
  });

  sleep(randomBetween(1, 2));

  // Fetch history
  const historyResponse = http.get(`${BASE_URL}/chat/conversations/${conversationId}/messages?limit=50`, {
    headers: { "Content-Type": "application/json" },
    tags: { endpoint: "history" },
  });

  check(historyResponse, {
    "history: status 200": (res) => res.status === 200,
    "history: has messages array": (res) => {
      const body = safeJson(res);
      return Array.isArray(body && body.messages);
    },
  });

  sleep(randomBetween(2, 3));
}

export function handleSummary(data) {
  const timestamp = new Date().toISOString();
  const filename = `/tmp/k6-results-${timestamp.replace(/[:.]/g, "-")}.json`;
  const payload = {
    generatedAt: timestamp,
    baseUrl: BASE_URL,
    stages: STAGES,
    options: { vus: TARGET_VUS, duration: TEST_DURATION },
    metrics: {
      httpReqs: data.metrics.http_reqs,
      httpReqFailed: data.metrics.http_req_failed,
      sendDuration: data.metrics["http_req_duration{endpoint:send}"],
      historyDuration: data.metrics["http_req_duration{endpoint:history}"],
    },
    thresholds: data.thresholds,
  };

  return {
    stdout: `${JSON.stringify({ summaryFile: filename, thresholds: data.thresholds }, null, 2)}\n`,
    [filename]: JSON.stringify(payload, null, 2),
  };
}
