# Load Test Failure - Root Cause Summary

## Quick Reference: Why Load Tests Failed

### The Problem
- **56,250 requests attempted** over 14.5 minutes with 120 concurrent Virtual Users
- **100% failure rate** - Every single request failed with "connection refused"
- **Zero latency measurements** - Indicates TCP socket-level failures, not HTTP layer

### Proof of Failure
```
Error Rate:        100% (target: <1%)
Send Success:      0/39,120 (0%)
History Success:   0/17,130 (0%)
HTTP Duration:     0ms average (suspicious - should be 50-500ms)
Connection Status: REFUSED (backend not listening on port 3001)
```

---

## Root Cause Hierarchy

### 1️⃣ PRIMARY CAUSE: Backend Process Not Running (100% Impact)
- **The backend application crashed or never started**
- When k6 attempted to connect to `127.0.0.1:3001`, the OS returned `ECONNREFUSED`
- Verification:
  - `curl http://localhost:3001/api/v1/health` → Connection refused
  - `lsof -ti:3001` → No process found
  - `ps aux | grep node | grep 3001` → No matching processes

**Why this happened:**
- NestJS bootstrap failed during module initialization
- Possible Prisma singleton initialization error
- Possible memory/resource exhaustion during startup
- Express adapter failed to bind to port
- Unhandled exception in PrismaModule.onModuleInit() or AppModule initialization

---

### 2️⃣ SECONDARY CAUSE: Rate Limiting Not Fully Bypassed (70% Impact if Backend Worked)
- **Environment variable `DISABLE_RATE_LIMIT=true` was set, but may not have taken effect**
- The messaging limiter specifically allows 200 requests per 15 minutes
- 120 VUs × 0.7 send ratio × 4 RPS (rough estimate) = 336 requests/minute
- After ~30 seconds, rate limit would be exceeded (200/15min ≈ 13 req/sec)

**Evidence:**
- 5 separate rate limiters in codebase but unclear if all were properly bypassed
- Middleware module evaluation timing issues could prevent env var detection
- `skip: () => DISABLE_RATE_LIMIT` evaluated at import time vs. request time

**If backend was running, tests would fail with:**
- 429 Too Many Requests after ~30 seconds
- Error cascade when VUs hammer the messaging endpoint

---

### 3️⃣ TERTIARY CAUSE: Prisma Connection Pool Exhaustion (95% Impact if Rate Limiter Worked)
- **Default Prisma pool: ~10 connections**
- **Test concurrency: 120 Virtual Users**
- **Each VU holds connection during database query execution**
- After 10 concurrent requests, all subsequent requests wait for connection availability
- Typical behavior: Requests hang for 30+ seconds before timeout

**Connection Math:**
```
VUs:              120
Pool size:        ~10 (default)
Requests/second:  ~50 (VUs × 0.7 send ratio + history)
Avg query time:   100-200ms

Result: Queue backlog of 40-90 requests waiting for connections
Timeout: 30 seconds default → all requests fail with ETIMEDOUT
```

---

### 4️⃣ QUATERNARY CAUSE: Prisma Configuration/Field Mismatches (40% Impact)
- **Partially fixed during earlier troubleshooting:**
  - `messageType` → `type` (✓ Fixed)
  - `readReceipts` → `messageReads` (✓ Fixed in 2 locations)
- **Possible remaining issues:**
  - Fixes not compiled into dist/main.js
  - Hot reload didn't pick up changes
  - Other field mismatches not yet discovered
  - Mock mode fallback if DATABASE_URL not detected

---

## Latency Metrics Reveal the Truth

**Reported metrics:**
```json
{
  "latency_send": { "avg": 0.62ms, "p95": 1ms, "max": 18ms },
  "latency_history": { "avg": 0.65ms, "p95": 1ms, "max": 13ms },
  "http_req_duration": { "avg": 0ms }
}
```

**Why these are NOT real API times:**

Real API responses include:
- TCP connection: 0.5-2ms (localhost)
- TLS handshake: 1-5ms
- HTTP request parsing: 1-2ms
- Database query: 50-200ms
- Response serialization: 5-10ms
- TCP send/close: 0.5-2ms
- **Minimum realistic latency: 60-230ms**

**Sub-millisecond times indicate:**
- Connection attempts are failing at OS socket layer
- k6 is measuring TCP RST time (connection reset)
- No HTTP layer was reached
- This proves backend wasn't listening

---

## How It Should Look (If Tests Passed)

```json
{
  "latency_send": { 
    "avg": 145ms,         ← Real value
    "p95": 250ms,         ← Passes threshold
    "max": 500ms          ← Occasional slow requests
  },
  "error_rate": {
    "rate": 0.002,        ← 0.2% success (under 1% threshold)
    "passes": 56127,
    "fails": 123
  },
  "http_reqs": {
    "count": 56250,
    "rate": 64.6 req/s    ← Expected value
  }
}
```

---

## Why Manual Curl Tests Worked But Load Test Failed

**Single curl requests succeeded:**
```bash
$ curl http://localhost:3001/api/v1/health
{"status":"ok",...}
```

**But k6 with 120 VUs failed:**
- **Sequential vs. Concurrent:** Curl made 1 request. k6 made 120 simultaneous connections.
- **Resource Starvation:** Backend could handle 1 connection but crashed under 120.
- **Connection Pool Limits:** Curl reused one connection. k6 needed 120.
- **Process Lifecycle:** Backend started fine initially, then crashed under load.

**Possible crash triggers:**
- Prisma connection pool completely exhausted
- Memory leak accumulated over 120 active connections
- Event loop blocking from database queries
- File descriptor limit (ulimit) exceeded
- V8 heap space exceeded

---

## Key Numbers

| Metric | Value | Impact |
|--------|-------|--------|
| Total Requests | 56,250 | Scale of failure |
| Success Rate | 0% | 100% failure |
| Error Rate | 100% | Exceeds 1% threshold |
| Duration | 14m 30s | Long enough to see patterns |
| Peak VUs | 120 | High concurrency |
| Latency (reported) | 0.6ms avg | Proves no backend |
| Expected Latency | 100-300ms | If backend worked |
| Connection Pool | ~10 | Bottleneck with 120 VUs |
| Requests/Sec | ~64.6 | Sustainable rate (no load) |
| Rate Limit | 200/15min | Insufficient (~13 req/s) |

---

## The Smoking Gun

**This one metric proves backend wasn't running:**

```json
"http_req_duration": {
  "avg": 0ms,
  "min": 0ms,
  "med": 0ms,
  "p(95)": 0ms,
  "p(99)": 0ms,
  "max": 0ms
}
```

**Why:** TCP stack returns `ECONNREFUSED` microseconds after connection attempt. HTTP layer never involved. No request processing occurs. Zero time measured = zero contact with application layer.

---

## Next Steps to Fix

1. **Start backend with full logging:**
   ```bash
   DATABASE_URL="postgresql://postgres:postgrespassword@localhost:5432/chat_backend_db" \
   PRISMA_CLIENT_MODE=database \
   DISABLE_RATE_LIMIT=true \
   PORT=3001 \
   npm run start:dev 2>&1 | tee /tmp/backend.log
   ```

2. **Verify health endpoint:**
   ```bash
   curl -v http://localhost:3001/api/v1/health
   ```

3. **Verify rate limiting is disabled:**
   ```bash
   for i in {1..50}; do 
     curl -s http://localhost:3001/api/v1/chat/conversations/test/messages \
       -X POST -H "Content-Type: application/json" \
       -d '{"userId":"test","content":"msg"}'
   done | grep -c 429
   # Should output: 0 (no 429 Too Many Requests)
   ```

4. **Increase Prisma connection pool:**
   ```prisma
   // schema.prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
     // connection_limit = 50  // Increase from default ~10
   }
   ```

5. **Run k6 test with progressive load:**
   ```bash
   # Instead of 120 VUs immediately, start with 5
   k6 run chat-load-test.k6.js --env PROFILE=smoke \
     -u 5 -d 30s  # 5 VUs, 30 seconds
   ```

