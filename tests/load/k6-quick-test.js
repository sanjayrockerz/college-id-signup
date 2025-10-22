// k6 Quick Load Test - Validation
// Tests basic functionality with moderate load
// Run: k6 run tests/load/k6-quick-test.js

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

// Custom metrics
const errorRate = new Rate("errors");
const latencyTrend = new Trend("request_latency");
const cacheHits = new Counter("cache_hits");
const cacheMisses = new Counter("cache_misses");

// Test configuration - Quick validation test
export const options = {
  stages: [
    { duration: "30s", target: 50 }, // Ramp to 50 VUs
    { duration: "1m", target: 50 }, // Hold at 50
    { duration: "30s", target: 100 }, // Ramp to 100
    { duration: "1m", target: 100 }, // Hold at 100
    { duration: "30s", target: 0 }, // Ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.05"],
    errors: ["rate<0.05"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
const CONVERSATION_ID = __ENV.CONVERSATION_ID || "conv-1";
const USER_ID = __ENV.USER_ID || "user-1";

export function setup() {
  console.log("🚀 Starting quick validation test...");
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   Target: 100 concurrent VUs`);
  console.log("");

  const healthRes = http.get(`${BASE_URL}/api/v1/health`);
  const cacheHealthRes = http.get(`${BASE_URL}/api/v1/health/cache`);

  check(healthRes, {
    "app health ok": (r) => r.status === 200,
  });

  check(cacheHealthRes, {
    "cache health ok": (r) => r.status === 200,
  });

  return {
    startTime: new Date().toISOString(),
  };
}

export default function () {
  // 70% reads, 30% writes
  const scenario = Math.random();

  if (scenario < 0.7) {
    getMessages();
  } else {
    sendMessage();
  }

  sleep(Math.random() * 2 + 0.5);
}

function getMessages() {
  const startTime = new Date().getTime();
  const res = http.get(
    `${BASE_URL}/api/v1/chat/conversations/${CONVERSATION_ID}/messages?userId=${USER_ID}&limit=50`,
    { headers: { "Content-Type": "application/json" } },
  );
  const duration = new Date().getTime() - startTime;

  latencyTrend.add(duration);

  const success = check(res, {
    "status is 200": (r) => r.status === 200,
    "has messages": (r) => {
      try {
        const body = r.json();
        return body.messages !== undefined;
      } catch {
        return false;
      }
    },
  });

  if (success && res.status === 200) {
    try {
      const body = res.json();
      if (body.fromCache === true) {
        cacheHits.add(1);
      } else {
        cacheMisses.add(1);
      }
    } catch {}
  }

  if (!success) {
    errorRate.add(1);
  }
}

function sendMessage() {
  const payload = JSON.stringify({
    userId: USER_ID,
    content: `Quick test ${Date.now()}`,
    messageType: "TEXT",
  });

  const res = http.post(
    `${BASE_URL}/api/v1/chat/conversations/${CONVERSATION_ID}/messages`,
    payload,
    { headers: { "Content-Type": "application/json" } },
  );

  const success = check(res, {
    "status is 2xx": (r) => r.status >= 200 && r.status < 300,
  });

  if (!success) {
    errorRate.add(1);
  }
}

export function teardown(data) {
  console.log("");
  console.log("✅ Quick validation test complete");
  console.log(`   Duration: ${new Date().toISOString()}`);

  const finalCache = http.get(`${BASE_URL}/api/v1/health/cache`);
  if (finalCache.status === 200) {
    const metrics = finalCache.json("metrics");
    console.log("");
    console.log("📊 Cache Metrics:");
    console.log(`   Hit Ratio: ${metrics.hit_ratio_percentage}`);
    console.log(`   Hits: ${metrics.hits}, Misses: ${metrics.misses}`);
  }
}
