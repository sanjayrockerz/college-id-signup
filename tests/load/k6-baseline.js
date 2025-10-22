// k6 Load Test - Baseline (No Cache, Direct DB)
// Tests connection pooling and database performance without cache layer
// Run: k6 run --vus 100 --duration 5m k6-baseline.js

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

// Custom metrics
const errorRate = new Rate("errors");
const latencyTrend = new Trend("request_latency");
const requestCount = new Counter("total_requests");

// Test configuration
export const options = {
  scenarios: {
    // Ramp-up test: 1k, 5k, 10k connections
    staged_load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 1000 }, // Ramp to 1k
        { duration: "3m", target: 1000 }, // Hold at 1k
        { duration: "2m", target: 5000 }, // Ramp to 5k
        { duration: "3m", target: 5000 }, // Hold at 5k
        { duration: "2m", target: 10000 }, // Ramp to 10k
        { duration: "3m", target: 10000 }, // Hold at 10k
        { duration: "2m", target: 0 }, // Ramp down
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<500", "p(99)<1000"], // 95% < 500ms, 99% < 1s
    http_req_failed: ["rate<0.01"], // Error rate < 1%
    errors: ["rate<0.01"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
const CONVERSATION_ID = __ENV.CONVERSATION_ID || "conv-1";
const USER_ID = __ENV.USER_ID || "user-1";

// Disable cache for baseline test
const CACHE_BYPASS = true;

export function setup() {
  console.log("🚀 Starting baseline load test...");
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   Cache: DISABLED (baseline test)`);
  console.log("");

  // Health check
  const healthRes = http.get(`${BASE_URL}/api/v1/health`);
  check(healthRes, {
    "health check passed": (r) => r.status === 200,
  });

  return { startTime: new Date().toISOString() };
}

export default function () {
  // Simulate realistic user behavior: 70% reads, 30% writes
  const scenario = Math.random();

  if (scenario < 0.7) {
    // Read operation: Get messages
    getMessages();
  } else {
    // Write operation: Send message
    sendMessage();
  }

  // Think time: 1-3 seconds between requests
  sleep(Math.random() * 2 + 1);
}

function getMessages() {
  const headers = {
    "Content-Type": "application/json",
  };

  if (CACHE_BYPASS) {
    headers["X-Cache-Bypass"] = "true";
  }

  const startTime = new Date().getTime();
  const res = http.get(
    `${BASE_URL}/api/v1/chat/conversations/${CONVERSATION_ID}/messages?userId=${USER_ID}&limit=50`,
    { headers },
  );
  const duration = new Date().getTime() - startTime;

  latencyTrend.add(duration);
  requestCount.add(1);

  const success = check(res, {
    "status is 200": (r) => r.status === 200,
    "has messages": (r) => r.json("messages") !== undefined,
    "response time < 1000ms": () => duration < 1000,
  });

  if (!success) {
    errorRate.add(1);
    console.error(`❌ GET messages failed: ${res.status}`);
  }
}

function sendMessage() {
  const headers = {
    "Content-Type": "application/json",
  };

  const payload = JSON.stringify({
    userId: USER_ID,
    content: `Load test message at ${new Date().toISOString()}`,
    messageType: "TEXT",
  });

  const startTime = new Date().getTime();
  const res = http.post(
    `${BASE_URL}/api/v1/chat/conversations/${CONVERSATION_ID}/messages`,
    payload,
    { headers },
  );
  const duration = new Date().getTime() - startTime;

  latencyTrend.add(duration);
  requestCount.add(1);

  const success = check(res, {
    "status is 201": (r) => r.status === 201 || r.status === 200,
    "message created": (r) =>
      r.json("success") === true || r.json("message") !== undefined,
    "response time < 2000ms": () => duration < 2000,
  });

  if (!success) {
    errorRate.add(1);
    console.error(`❌ POST message failed: ${res.status}`);
  }
}

export function teardown(data) {
  console.log("");
  console.log("✅ Baseline load test complete");
  console.log(`   Start time: ${data.startTime}`);
  console.log(`   End time: ${new Date().toISOString()}`);
  console.log("");
  console.log("📊 Check Grafana dashboards for detailed metrics");
  console.log("   - PgBouncer queue wait times");
  console.log("   - PostgreSQL connection count");
  console.log("   - Request latency percentiles");
}
