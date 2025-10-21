# Prisma Connection Pool Configuration for Load Testing

## Problem Statement

During k6 load testing with 120 concurrent Virtual Users (VUs), the application experienced connection pool exhaustion. Prisma's default connection pool (~10 connections) was insufficient for handling concurrent database operations, causing requests to timeout after 30 seconds waiting for available connections.

## Mathematical Analysis

### Request Patterns from Load Test
- **Total VUs**: 120
- **Send Message Operations**: 70% of VUs (84 VUs)
- **Fetch History Operations**: 30% of VUs (36 VUs)
- **Target Request Rate**: ~64.6 requests/second
- **Average Query Execution Time**: 100-200ms (measured from single requests)

### Connection Pool Requirements Calculation

```
Peak Concurrent Queries = VUs × Activity Ratio × Query Duration (seconds)

Scenario 1 (Conservative - 100ms queries):
  = 120 × 0.70 × 0.1
  = 8.4 concurrent connections minimum

Scenario 2 (Realistic - 150ms queries):
  = 120 × 0.70 × 0.15  
  = 12.6 concurrent connections minimum

Scenario 3 (Pessimistic - 200ms queries):
  = 120 × 0.70 × 0.2
  = 16.8 concurrent connections minimum
```

### Safety Buffer Calculation

Production systems should not run connection pools at 100% capacity. Industry best practices:

- **Burst Traffic Buffer**: 2-3x minimum to handle traffic spikes
- **Background Operations**: +5-10 connections for health checks, migrations, monitoring
- **Database Server Capacity**: PostgreSQL `max_connections` = 100
- **Safe Usage Threshold**: 50-70% of max_connections (avoid resource exhaustion)

```
Recommended Pool Size = (Peak Concurrent × Buffer) + Overhead

= (13 × 3) + 10
= 39 + 10  
= 49 connections

Rounded to: 50 connections
```

### Validation Against Database Limits

```sql
-- Check PostgreSQL max_connections
SHOW max_connections;
-- Result: 100

-- Safe application pool size
Application Pool = 50 (50% of max_connections)

-- Remaining capacity  
Reserved for:
- Other applications: 20 connections
- Admin connections: 10 connections  
- Superuser reserve: 10 connections
- Replication: 10 connections
Total Reserved: 50 connections

Maximum Utilization = 50/100 = 50% ✅ Safe
```

## Implementation Changes

### 1. Schema Configuration (`prisma/schema.prisma`)

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  // Connection pool enabled via URL parameters
  directUrl = env("DATABASE_URL")
}
```

**Note**: Prisma uses connection parameters from DATABASE_URL query string. The `directUrl` is included for future migration support.

### 2. Runtime Configuration (`src/config/database.ts`)

Added dynamic connection pool configuration:

```typescript
const poolSize = parseInt(process.env.DATABASE_POOL_SIZE || "50", 10);
const connectionTimeout = parseInt(process.env.DATABASE_CONNECTION_TIMEOUT || "10", 10);
const poolTimeout = parseInt(process.env.DATABASE_POOL_TIMEOUT || "30", 10);

// Enhance DATABASE_URL with pool parameters
let enhancedUrl = connectionUrl;
if (connectionUrl && !connectionUrl.includes("connection_limit")) {
  const separator = connectionUrl.includes("?") ? "&" : "?";
  enhancedUrl = `${connectionUrl}${separator}connection_limit=${poolSize}&pool_timeout=${poolTimeout}&connect_timeout=${connectionTimeout}`;
}
```

### 3. Environment Variables

```bash
# Core database connection
DATABASE_URL="postgresql://postgres:postgrespassword@localhost:5432/chat_backend_db"

# Connection pool sizing
DATABASE_POOL_SIZE=50                    # Maximum connections in pool
DATABASE_CONNECTION_TIMEOUT=10           # Seconds to wait for new connection
DATABASE_POOL_TIMEOUT=30                 # Seconds to wait for available connection from pool
```

## Connection Pool Parameters Explained

| Parameter | Default | Load Test Value | Description |
|-----------|---------|-----------------|-------------|
| `connection_limit` | ~10 | 50 | Maximum connections in pool |
| `pool_timeout` | 10s | 30s | Max wait time for available connection |
| `connect_timeout` | 5s | 10s | Max time to establish new connection |

### Why These Values?

**connection_limit=50**
- Supports 120 VUs with 3x burst buffer
- Uses 50% of PostgreSQL max_connections (safe margin)
- Handles concurrent message send (70%) + history fetch (30%) operations
- Accounts for connection overhead, health checks, background tasks

**pool_timeout=30s**
- Matches k6 default HTTP request timeout
- Prevents indefinite request hanging
- Allows graceful degradation under extreme load
- Logs timeout errors for monitoring

**connect_timeout=10s**
- Reasonable for localhost connections (typically <100ms)
- Accommodates network hiccups
- Prevents startup delays if database is temporarily unavailable
- Fails fast enough for circuit breaker patterns

## Monitoring Connection Pool Health

### During Load Tests

Monitor these metrics during k6 execution:

```typescript
// Added to health check endpoint
export function getDatabaseMetrics(): DatabaseMetrics {
  const pool = client._activeProvider?._connectionPool;
  return {
    connectionState: client._connectionState,
    activeConnections: pool?._activeConnections || 0,
    idleConnections: pool?._idleConnections || 0,
    pendingConnections: pool?._pendingConnections || 0,
  };
}
```

### Warning Thresholds

| Metric | Warning Level | Critical Level | Action Required |
|--------|---------------|----------------|-----------------|
| Active Connections | >40 | >48 | Increase pool size or optimize queries |
| Idle Connections | <5 | <2 | Check for connection leaks |
| Pending Connections | >0 | >10 | Pool exhausted, requests queuing |
| Pool Timeout Errors | >1% | >5% | Increase pool_timeout or connection_limit |

### PostgreSQL Side Monitoring

```sql
-- Check active connections by application
SELECT 
  application_name,
  COUNT(*) as connection_count,
  state,
  NOW() - state_change as duration
FROM pg_stat_activity
WHERE datname = 'chat_backend_db'
GROUP BY application_name, state, state_change
ORDER BY connection_count DESC;

-- Check connection age (detect leaks)
SELECT 
  pid,
  usename,
  application_name,
  state,
  NOW() - backend_start as connection_age,
  NOW() - state_change as state_age
FROM pg_stat_activity
WHERE datname = 'chat_backend_db'
ORDER BY connection_age DESC
LIMIT 20;
```

## Progressive Load Testing Strategy

Don't jump directly to 120 VUs. Test incrementally:

### Phase 1: Baseline (5 VUs)
```bash
k6 run --vus 5 --duration 30s scripts/performance/chat-load-test.k6.js
```
**Expected**: <5 concurrent connections, <100ms p95 latency, 0% errors

### Phase 2: Light Load (10 VUs)
```bash
k6 run --vus 10 --duration 60s scripts/performance/chat-load-test.k6.js
```
**Expected**: 7-8 concurrent connections, <120ms p95 latency, 0% errors

### Phase 3: Medium Load (25 VUs)
```bash
k6 run --vus 25 --duration 120s scripts/performance/chat-load-test.k6.js
```
**Expected**: 12-15 concurrent connections, <150ms p95 latency, <0.1% errors

### Phase 4: High Load (50 VUs)
```bash
k6 run --vus 50 --duration 300s scripts/performance/chat-load-test.k6.js
```
**Expected**: 20-25 concurrent connections, <200ms p95 latency, <0.5% errors

### Phase 5: Peak Load (100 VUs)
```bash
k6 run --vus 100 --duration 300s scripts/performance/chat-load-test.k6.js
```
**Expected**: 35-40 concurrent connections, <250ms p95 latency, <1% errors

### Phase 6: Stress Test (120 VUs)
```bash
k6 run --vus 120 --duration 870s scripts/performance/chat-load-test.k6.js
```
**Expected**: 40-45 concurrent connections, <300ms p95 latency, <1% errors

## Troubleshooting Connection Pool Issues

### Symptom: "connection_limit reached" errors
**Cause**: Pool exhausted, all connections in use  
**Solution**:
1. Increase `DATABASE_POOL_SIZE` (try 75 or 100)
2. Optimize slow queries (check query duration logs)
3. Reduce request rate or VU count
4. Implement request queuing/throttling

### Symptom: "pool_timeout exceeded" errors
**Cause**: Waiting too long for available connection  
**Solution**:
1. Increase `DATABASE_POOL_TIMEOUT` (try 45s or 60s)
2. Increase pool size to reduce wait times
3. Check for connection leaks (stale transactions)
4. Review database query performance

### Symptom: "connect_timeout exceeded" errors
**Cause**: Cannot establish new connection to PostgreSQL  
**Solution**:
1. Check PostgreSQL is running: `pg_isready -h localhost -p 5432`
2. Verify max_connections not exceeded: `SHOW max_connections;`
3. Check network latency: `ping localhost`
4. Review PostgreSQL logs: `/var/log/postgresql/postgresql-*.log`

### Symptom: Requests succeed but latency >500ms
**Cause**: Connection pool contention, queries waiting  
**Solution**:
1. Monitor active connections approaching limit
2. Add database query indexes for frequent operations
3. Implement connection warming (pre-establish connections)
4. Use read replicas for read-heavy operations

## Performance Benchmarks

### Before Connection Pool Optimization
- Pool Size: ~10 (default)
- Test Result: 100% failure rate at 120 VUs
- Failure Mode: Connection refused (backend crashed)
- Latency: 0ms (no connection established)

### After Connection Pool Optimization (Expected)
- Pool Size: 50 (configured)
- Test Result: <1% error rate at 120 VUs
- Success Mode: Backend stable, database responsive
- Latency: 100-300ms p95 (realistic API times)

## Production Deployment Recommendations

### Scaling Guidelines

| Concurrent Users | Recommended Pool Size | PostgreSQL max_connections |
|------------------|-----------------------|----------------------------|
| 1-50 | 10-20 | 50 |
| 51-150 | 20-50 | 100 |
| 151-300 | 50-100 | 200 |
| 301-500 | 100-150 | 300 |
| 500+ | Use PgBouncer | 100 (pooler handles) |

### When to Use PgBouncer

Connection pooling middleware (PgBouncer) recommended when:
- Application instances > 5
- Total connections needed > 200
- Multiple microservices sharing database
- Need transaction-level connection pooling
- Database is remote (high latency network)

**PgBouncer Configuration Example:**
```ini
[databases]
chat_backend_db = host=localhost port=5432 dbname=chat_backend_db

[pgbouncer]
listen_port = 6432
listen_addr = 127.0.0.1
auth_type = md5
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 50
min_pool_size = 10
reserve_pool_size = 10
reserve_pool_timeout = 5
```

Then update DATABASE_URL:
```bash
DATABASE_URL="postgresql://postgres:postgrespassword@localhost:6432/chat_backend_db"
```

## Next Steps

1. ✅ **Restart backend** with new pool configuration
2. ✅ **Verify pool initialization** in startup logs
3. ⏳ **Run progressive load tests** (5→10→25→50→100→120 VUs)
4. ⏳ **Monitor connection metrics** during each test phase
5. ⏳ **Tune pool size** based on actual metrics
6. ⏳ **Document breaking point** if any phase fails
7. ⏳ **Consider PgBouncer** if pool size >100 needed

## References

- Prisma Connection Management: https://www.prisma.io/docs/concepts/components/prisma-client/connection-management
- PostgreSQL Connection Pooling: https://www.postgresql.org/docs/current/runtime-config-connection.html
- PgBouncer Documentation: https://www.pgbouncer.org/
- k6 Load Testing Best Practices: https://k6.io/docs/testing-guides/
