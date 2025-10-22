import http from "k6/http";
import { sleep, check } from "k6";

export const options = {
  stages: [
    { duration: "5m", target: 500 }, // ramp-up
    { duration: "10m", target: 500 }, // sustain
    { duration: "10s", target: 1000 }, // spike up
    { duration: "5m", target: 1000 }, // sustain spike
    { duration: "2m", target: 100 }, // ramp down
    { duration: "2h", target: 200 }, // soak (can run separately)
  ],
  thresholds: {
    "http_req_duration{endpoint:send}": ["p(95)<250"],
    "http_req_duration{endpoint:history}": ["p(95)<350"],
    http_req_failed: ["rate<0.01"],
  },
};

const BASE = __ENV.BASE_URL || "http://localhost:3001";

export default function () {
  const userId = "user-" + Math.floor(Math.random() * 1e9);
  const convId = "conv-" + Math.floor(Math.random() * 1e6);

  const sendRes = http.post(
    `${BASE}/api/v1/chat/conversations/${convId}/messages`,
    JSON.stringify({ userId, content: "hello" }),
    {
      headers: { "Content-Type": "application/json" },
      tags: { endpoint: "send" },
    },
  );
  check(sendRes, {
    "send status is 201|200": (r) => r.status === 201 || r.status === 200,
  });

  const historyRes = http.get(
    `${BASE}/api/v1/chat/conversations/${convId}/messages?limit=20`,
    {
      tags: { endpoint: "history" },
    },
  );
  check(historyRes, { "history status is 200": (r) => r.status === 200 });

  sleep(1);
}
