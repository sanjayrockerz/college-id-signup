# Load Test Failure Analysis - Comprehensive Report

## Executive Summary

The k6 load testing framework executed 56,250 HTTP requests over a 14.5-minute test duration with a peak of 120 Virtual Users (VUs), but **achieved a 100% connection failure rate**. Every single request returned "connection refused" errors, meaning the NestJS backend on port 3001 was not accepting any connections. While the latency metrics show sub-millisecond times (0-13ms for send, 0-13ms for history), these measurements represent failed connection attempts rather than actual API responses. Both the "send" and "history" error rate thresholds were exceeded (100% vs. target <1%).

---

## Root Cause: Backend Service Unavailability

### Primary Issue: Process Crash or Startup Failure

The backend application (NestJS chat service on port 3001) **consistently crashed or failed to bind to the port** during load testing execution. When k6 attempted to initiate requests, the operating system immediately returned `ECONNREFUSED` errors, indicating:

1. **No process listening on 127.0.0.1:3001** - Either the backend never started, or crashed early in the test
2. **Socket closure before connection acceptance** - The port was either not bound or became unbound during test execution
3. **Resource exhaustion or initialization failure** - The application may have run out of memory, file descriptors, or encountered a fatal error during module initialization

### Evidence from Test Results

The k6 metrics confirm the severity:

```
history_error_rate: { rate: 1 }          ← 100% history requests failed
send_error_rate: { rate: 1 }              ← 100% send requests failed
http_req_duration: { avg: 0ms }           ← Zero response time = connection level failure
http_req_failed: { rate: 1, passes: 56250 }  ← All 56,250 requests failed
```

**The zero response times for `http_req_duration` are the smoking gun.** Normal HTTP requests would show measurable latency (at minimum TCP handshake + TLS negotiation + request/response overhead). Zero latency indicates the failures occurred at the socket/TCP layer, not the HTTP application layer.

---

## Secondary Issue: Rate Limiting Bypass Incompletely Applied

While rate limiting was configured to be disabled via the `DISABLE_RATE_LIMIT=true` environment variable, and the code modifications were made to add `skip: () => DISABLE_RATE_LIMIT` logic, there may be subtle issues preventing the bypass from working correctly:

### Rate Limiter Configuration Code

The middleware in `src/middleware/rateLimiter.ts` implements express-rate-limit with the following configuration:

```javascript
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,        // 15-minute window
  max: 300,                         // 300 requests per 15 minutes
  skip: () => DISABLE_RATE_LIMIT,   // Skip if env var is true
  // ...
});
```

**Potential Problems:**

1. **Environment Variable Timing** - The `DISABLE_RATE_LIMIT` variable may not be read when the middleware module loads. If the middleware module is imported/initialized before `process.env.DISABLE_RATE_LIMIT` is available, the skip function will see `undefined`.

2. **Module Evaluation Order** - In Node.js, module exports are evaluated at require time. If `const DISABLE_RATE_LIMIT = process.env.DISABLE_RATE_LIMIT === 'true'` is evaluated at import time (not function call time), it will capture the value before environment variables are fully propagated.

3. **Multiple Rate Limiters** - The codebase has 5 separate rate limiters (apiLimiter, writeOperationLimiter, uploadLimiter, messagingLimiter, adminLimiter). The `skip` fix may not have been applied to ALL of them, causing the messaging limiter to reject requests with 429 (Too Many Requests) status.

4. **Cumulative Limits** - Even with 120 VUs performing operations for 14.5 minutes, if any single rate limiter isn't properly bypassed, the test could hit limits. At 50 requests/second with 0.7 send ratio = 35 send requests/second × 14.5 minutes × 60 seconds = 303,000 potential send operations, which vastly exceeds typical rate limits.

---

## Tertiary Issue: Prisma Configuration Mismatch

The code uses a **singleton Prisma client** via a custom database configuration module (`src/config/database.ts`). This approach introduces several potential failure modes:

### Singleton Initialization Timing

```typescript
// In PrismaModule.onModuleInit():
await connectDatabase();
if (isPrismaMockMode()) {
  this.logger.warn("Prisma mock mode enabled...");
}
```

**Problems:**

1. **Mock Mode Detection** - The code checks `isPrismaMockMode()` which likely checks for a `DATABASE_URL` environment variable. If this variable is missing or incorrectly formatted, the application might fall back to mock mode (in-memory stubs) instead of connecting to the real PostgreSQL database.

2. **Connection Pool Exhaustion** - With 120 concurrent VUs making requests, the Prisma connection pool might be exhausted. The default connection pool size is typically 10-20 connections. Load testing with 120 concurrent operations would require either connection pooling via PgBouncer or a larger pool size in the Prisma schema (`connection_limit` in schema.prisma).

3. **Database Connection Failure** - If `connectDatabase()` throws an error during `onModuleInit()`, NestJS will fail to complete module initialization, and the application will not bind to port 3001. The process would exit with a non-zero exit code.

### Field Name Mismatches (Already Fixed)

The repository layer had Prisma field name mismatches that were corrected during troubleshooting:
- `messageType` → `type` 
- `readReceipts` → `messageReads`

However, if these fixes were only partially applied or if the built JavaScript doesn't reflect the TypeScript changes, the runtime queries would still fail.

---

## Quaternary Issue: NestJS Application Startup Failures

The NestJS bootstrap process (`src/main.ts` and `src/app.bootstrap.ts`) has several potential failure points:

### Middleware Chain Initialization

```typescript
app.use(requestIdMiddleware);
app.use(requestLoggingMiddleware);
app.use(metricsMiddleware);
```

If any middleware throws an error during setup (e.g., file system access, environment variable parsing), the application won't start.

### CORS and Security Headers Configuration

The app sets 10+ security headers and complex CORS configuration. If these contain errors (e.g., malformed header values), Express might fail to bind.

### Module Dependency Resolution

The AppModule imports: `PrismaModule → CommonModule → UserModule → ChatModule`

If any of these modules fails to initialize (missing providers, circular dependencies, async initialization errors), the bootstrap fails silently or with minimal logging.

### Express Adapter Configuration

```typescript
const server = express();
const app = await NestFactory.create(AppModule, new ExpressAdapter(server));
```

The custom Express adapter approach can introduce timing issues. If the underlying Express server isn't properly configured before NestFactory.create completes, subsequent `.listen()` calls may fail.

---

## Tertiary Issue: Test Configuration Mismatches

### URL and Port Discrepancies

The k6 test script has a default URL of `http://localhost:3000/api/v1/chat`, but the environment variable passed during execution was `CHAT_BASE_URL="http://localhost:3001/api/v1/chat"`. 

**Potential Problem:** If the environment variable wasn't properly exported or the k6 process didn't inherit it, the tests would attempt to connect to port 3000 (where no backend was running) instead of port 3001.

### Conversation and User ID Validity

The test was configured with:
```
CONVERSATION_IDS="8822dd87-d0c2-42be-93d2-1c0cb492e351"
USER_IDS="00000000-0000-0000-0000-000000000000"
```

While the database was seeded with this test data, if the seed script failed silently or if the database was reset between seeding and testing, these records might not exist. However, this would cause **400/404 HTTP responses, not connection refused**.

---

## Why Latency Metrics Are Misleading

The reported latencies in the metrics file are **NOT actual API response times**:

```json
"latency_send": {
  "avg": 0.6234406952965236,
  "p(95)": 1,
  "max": 18
}
```

These microsecond-scale timings represent the overhead of:
1. Socket connection attempt (~0-5ms for localhost)
2. TCP reset/close handshake (~0-5ms)
3. k6 measurement overhead

These are **NOT** application processing times. Real API latencies should be 50-500ms including database queries. The 0ms average indicates no HTTP layer was even reached.

---

## Environment Configuration Verification

The backend should have been started with:

```bash
DATABASE_URL="postgresql://postgres:postgrespassword@localhost:5432/chat_backend_db" \
PRISMA_CLIENT_MODE=database \
DISABLE_RATE_LIMIT=true \
PORT=3001 \
npm run start:dev
```

**Verification Steps That Failed:**
- ✗ `curl http://localhost:3001/api/v1/health` returned "Backend not responding"
- ✗ `lsof -ti:3001` showed no process bound to the port
- ✗ `ps aux | grep node | grep 3001` returned no matching processes

This definitively proves the backend application process either never started or crashed before binding to port 3001.

---

## Cumulative Failure Cascade

The load test failure resulted from a cascade of issues:

1. **Backend startup failure** (PRIMARY) → No socket listening on port 3001
2. **k6 test initiation** → Attempts to open TCP connection to 127.0.0.1:3001
3. **OS socket layer** → `ECONNREFUSED` error returned
4. **k6 check failures** → `check(res, { "send status ok": ... })` fails because no HTTP response was received
5. **Error rate threshold breach** → 100% error rate vs. <1% threshold causes test to fail
6. **Metrics generation** → k6 records sub-millisecond "latencies" and 100% failure rates, writes to `docs/validation/performance-metrics.json`

---

## Why Manual Curl Tests Worked Earlier But Load Test Failed

During earlier troubleshooting, single `curl` requests to `http://localhost:3001/api/v1/chat/conversations/{id}/messages` succeeded, showing:

```json
{
  "success": true,
  "data": {
    "messages": [...]
  }
}
```

**Why the same backend couldn't handle 56,250 requests from k6:**

1. **Resource Starvation** - The backend might handle 1-2 sequential requests fine but crash under concurrent load due to:
   - Connection pool exhaustion
   - Memory leak under high concurrency
   - File descriptor limit (ulimit) exceeded
   - Thread pool exhaustion in Node.js libuv

2. **Startup Timing** - The backend was successfully running after manual restart, but when k6 was launched as a child process or with environment variable scope issues, the backend might have crashed due to:
   - Sudden memory pressure from k6 startup
   - Race condition in initialization
   - Signal handling (e.g., SIGHUP) causing graceful shutdown

3. **Connection Pool Exhaustion** - With default Prisma config (~10 connections) and 120 concurrent VUs each holding a connection, the pool would be completely exhausted after 10 requests, causing all subsequent requests to wait forever or timeout.

---

## Data Flow Diagram of Failure

```
k6 Start (120 VUs)
    ↓
[Attempt TCP connection to 127.0.0.1:3001]
    ↓
OS Socket Layer → ECONNREFUSED
(Backend not listening / not started / crashed)
    ↓
k6 Error Handling
    ├→ No HTTP response received
    ├→ check() functions evaluate to false
    ├→ Error rate counter incremented
    └→ latency = 0ms (connection-level measurement only)
    ↓
Repeat 56,250 times over 14.5 minutes
    ↓
Final Metrics
├→ error_rate: 100%
├→ latency: 0ms average
├→ checks: 0 passed, 56250 failed
└→ threshold breached: FAIL
```

---

## Recommended Solutions

### Immediate Fixes

1. **Verify Backend Startup**
   ```bash
   # Start backend with full output visibility
   DATABASE_URL="postgresql://postgres:postgrespassword@localhost:5432/chat_backend_db" \
   PRISMA_CLIENT_MODE=database \
   DISABLE_RATE_LIMIT=true \
   PORT=3001 \
   npm run start:dev 2>&1 | tee backend.log
   ```
   Monitor for errors in the output.

2. **Verify All Rate Limiters Are Bypassed**
   - Check `src/middleware/rateLimiter.ts` for all 5 limiters
   - Verify each has `skip: () => DISABLE_RATE_LIMIT` or equivalent
   - Test with: `curl -i -X POST http://localhost:3001/api/v1/chat/conversations/test/messages ...` and verify no 429 responses

3. **Verify Prisma Connection**
   ```bash
   DATABASE_URL="postgresql://postgres:postgrespassword@localhost:5432/chat_backend_db" \
   PRISMA_CLIENT_MODE=database \
   npm run prisma:studio
   # Or: npx prisma db push && npx prisma generate
   ```

### Architectural Improvements

1. **Increase Prisma Connection Pool**
   ```prisma
   // In schema.prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
     // Add pool configuration
   }
   ```

2. **Implement Connection Pooling**
   - Use PgBouncer for PostgreSQL connection pooling
   - Configure pool size = (max_concurrent_requests / avg_request_duration) + overhead
   - For 120 VUs × 0.5s think time = 60-100 concurrent operations, need 30-50 Postgres connections

3. **Add Health Check Endpoints**
   - `/health` - basic liveness check
   - `/health/ready` - readiness check including database connectivity
   - `/metrics` - Prometheus-format metrics
   - Use these in k6 setup/teardown phases

4. **Implement Request Timeouts**
   - Set connection timeout: 5-10 seconds
   - Set request timeout: 30 seconds
   - Prevent indefinite hangs under load

5. **Add Graceful Degradation**
   - Implement circuit breakers for database
   - Return 503 (Service Unavailable) instead of crashing when pool exhausted
   - Queue requests or implement back-pressure

---

## Testing Recommendations for Next Load Test

1. **Pre-test Verification**
   ```bash
   # Run these before k6
   curl -v http://localhost:3001/api/v1/health
   curl -v http://localhost:3001/api/v1/chat/conversations
   ```

2. **Progressive Load Testing**
   - Start with 5 VUs, verify 100% success
   - Increase to 10, 20, 50, then 100+
   - Identify exact VU count where failures begin

3. **Resource Monitoring During Load**
   ```bash
   # Monitor in separate terminal
   watch -n 1 'ps aux | grep node | grep -v grep'
   top -p $(pgrep -f "nest start")
   ```

4. **Database Connection Monitoring**
   ```sql
   -- In PostgreSQL
   SELECT datname, usename, application_name, state, query_start 
   FROM pg_stat_activity 
   WHERE datname = 'chat_backend_db';
   ```

5. **k6 VU Ramp-up**
   - Reduce initial VU count and ramp slower
   - Add think time between requests
   - Test with shorter duration to isolate startup issues

---

## Conclusion

The 100% failure rate of the k6 load test was caused by **backend service unavailability** (primary issue) compounded by potential rate limiting configuration gaps and Prisma connection pool constraints. The zero-millisecond latencies indicate failures at the TCP socket layer, not the HTTP application layer. Fixing the backend startup process, ensuring all rate limiters are properly bypassed, and increasing database connection pool capacity should allow the load tests to proceed. Progressive load testing and proper resource monitoring will prevent similar failures in future test iterations.

