// k6 Load Test - Full Stack (PgBouncer + Redis Cache)
// Tests complete infrastructure with connection pooling and caching
// Run: k6 run --vus 100 --duration 5m k6-full-stack.js

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend, Counter, Gauge } from "k6/metrics";

// Custom metrics
const errorRate = new Rate("errors");
const latencyTrend = new Trend("request_latency");
const requestCount = new Counter("total_requests");
const cacheHitRate = new Gauge("cache_hit_rate");

// Test configuration
export const options = {
  scenarios: {
    // Staged load test
    staged_load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 1000 }, // Ramp to 1k
        { duration: "3m", target: 1000 }, // Hold at 1k (warmup)
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
    http_req_duration: ["p(95)<300", "p(99)<600"], // Stricter with cache
    http_req_failed: ["rate<0.01"],
    errors: ["rate<0.01"],
    cache_hit_rate: ["value>0.6"], // >60% hit ratio
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
const CONVERSATION_ID = __ENV.CONVERSATION_ID || "conv-1";
const USER_ID = __ENV.USER_ID || "user-1";

export function setup() {
  console.log("🚀 Starting full-stack load test (PgBouncer + Cache)...");
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   Cache: ENABLED`);
  console.log("");

  // Health checks
  const healthRes = http.get(`${BASE_URL}/api/v1/health`);
  const cacheHealthRes = http.get(`${BASE_URL}/api/v1/health/cache`);

  check(healthRes, {
    "app health check passed": (r) => r.status === 200,
  });

  check(cacheHealthRes, {
    "cache health check passed": (r) =>
      r.status === 200 && r.json("healthy") === true,
  });

  return {
    startTime: new Date().toISOString(),
    initialCacheMetrics: cacheHealthRes.json("metrics"),
  };
}

export default function () {
  // Realistic user behavior: 80% reads (cache will help), 20% writes
  const scenario = Math.random();

  if (scenario < 0.8) {
    // Read operation: Get messages (benefits from cache)
    getMessages();
  } else {
    // Write operation: Send message (invalidates cache)
    sendMessage();
  }

  // Periodic cache metrics check (1% of requests)
  if (Math.random() < 0.01) {
    checkCacheMetrics();
  }

  // Think time: 0.5-2 seconds (realistic user behavior)
  sleep(Math.random() * 1.5 + 0.5);
}

function getMessages() {
  const headers = {
    "Content-Type": "application/json",
  };

  const startTime = new Date().getTime();
  const res = http.get(
    `${BASE_URL}/api/v1/chat/conversations/${CONVERSATION_ID}/messages?userId=${USER_ID}&limit=50`,
    { headers },
  );
  const duration = new Date().getTime() - startTime;

  latencyTrend.add(duration);
  requestCount.add(1);

  const fromCache = res.json("fromCache") === true;

  const success = check(res, {
    "status is 200": (r) => r.status === 200,
    "has messages": (r) => r.json("messages") !== undefined,
    "response time < 500ms": () => duration < 500,
  });

  // Log cache performance
  if (fromCache && duration < 50) {
    // Cache hit with excellent performance
  } else if (!fromCache && duration > 200) {
    // Cache miss with slow DB query - may indicate issue
    if (Math.random() < 0.01) {
      // Log 1% to avoid spam
      console.warn(`⚠️  Cache miss with slow query: ${duration}ms`);
    }
  }

  if (!success) {
    errorRate.add(1);
    console.error(
      `❌ GET messages failed: ${res.status}, duration: ${duration}ms`,
    );
  }
}

function sendMessage() {
  const headers = {
    "Content-Type": "application/json",
  };

  const payload = JSON.stringify({
    userId: USER_ID,
    content: `Load test message ${Date.now()}`,
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
    "response time < 1000ms": () => duration < 1000,
  });

  if (!success) {
    errorRate.add(1);
    console.error(
      `❌ POST message failed: ${res.status}, duration: ${duration}ms`,
    );
  }
}

function checkCacheMetrics() {
  const res = http.get(`${BASE_URL}/api/v1/health/cache`);

  if (res.status === 200) {
    const metrics = res.json("metrics");
    if (metrics && metrics.total_requests > 0) {
      const hitRatio = metrics.hit_ratio || 0;
      cacheHitRate.add(hitRatio);

      // Log occasionally
      if (Math.random() < 0.1) {
        console.log(
          `📊 Cache: ${(hitRatio * 100).toFixed(1)}% hit ratio, ` +
            `${metrics.hits} hits, ${metrics.misses} misses`,
        );
      }
    }
  }
}

export function teardown(data) {
  console.log("");
  console.log("✅ Full-stack load test complete");
  console.log(`   Start time: ${data.startTime}`);
  console.log(`   End time: ${new Date().toISOString()}`);
  console.log("");

  // Final cache metrics
  const finalCacheRes = http.get(`${BASE_URL}/api/v1/health/cache`);
  if (finalCacheRes.status === 200) {
    const finalMetrics = finalCacheRes.json("metrics");
    const initialMetrics = data.initialCacheMetrics;

    console.log("📊 Cache Performance Summary:");
    console.log(`   Total Requests: ${finalMetrics.total_requests}`);
    console.log(
      `   Cache Hits: ${finalMetrics.hits} (Δ ${finalMetrics.hits - initialMetrics.hits})`,
    );
    console.log(
      `   Cache Misses: ${finalMetrics.misses} (Δ ${finalMetrics.misses - initialMetrics.misses})`,
    );
    console.log(`   Hit Ratio: ${finalMetrics.hit_ratio_percentage}`);
    console.log(`   Evictions: ${finalMetrics.evictions}`);
  }

  console.log("");
  console.log("📊 Check monitoring dashboards:");
  console.log("   - Grafana: http://localhost:3000");
  console.log("   - Prometheus: http://localhost:9090");
  console.log("   - Compare with baseline test results");
}
