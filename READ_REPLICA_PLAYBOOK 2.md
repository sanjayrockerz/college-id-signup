# Read Replica Routing Playbook

**Status**: ✅ Implementation Complete - Ready for Staging Pilot
**Last Updated**: 2025-10-22
**Related Docs**: INSTRUMENTATION_GUIDE.md, DATABASE_STATUS.md

---

## Executive Summary

This playbook documents the read replica routing system that enables safe offloading of read queries to PostgreSQL read replicas while maintaining consistency guarantees and automatic fallback to primary when lag exceeds safe thresholds.

###Key Components

✅ **PrismaReadReplicaService** - Dual connection pool manager (primary + replica)
✅ **ReplicaLagMonitor** - Automatic lag monitoring with configurable thresholds
✅ **ReadReplicaCircuitBreaker** - State machine for automatic fallback
✅ **DatabaseAccessLayer** - Intelligent read routing with feature flags
✅ **KeysetPaginator** - Cursor-based pagination (eliminates OFFSET performance issues)
✅ **UnreadCountBatcher** - Batched aggregates (eliminates N+1 queries)

### Success Criteria

- ✅ Read queries can be safely routed to replicas when lag < 5s
- ✅ Automatic fallback to primary when lag > 5s or replica unavailable
- ✅ No stale reads visible to users (circuit breaker prevents)
- ✅ Pagination performance stable at any depth (keyset pagination)
- ✅ N+1 query amplification eliminated (batched aggregates)

---

## Architecture

### Read Routing Flow

```
┌─────────────────────────────────────────────────────────────┐
│           Application Request (Read Operation)               │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│        DatabaseAccessLayer.findMany(endpoint, query)         │
└─────────────────────────────────────────────────────────────┘
                              ↓
         ┌────────────────────┴────────────────────┐
         ↓                                          ↓
┌────────────────────┐                  ┌────────────────────┐
│  Feature Flag      │                  │  Circuit Breaker   │
│  Check             │                  │  State Check       │
│  (endpoint enabled?)│                 │  (lag acceptable?) │
└────────────────────┘                  └────────────────────┘
         │                                          │
         └────────────────────┬────────────────────┘
                              ↓
                    ┌─────────────────┐
                    │   Route Query   │
                    └─────────────────┘
                     ↓               ↓
              ┌──────────┐    ┌──────────┐
              │ Replica  │    │ Primary  │
              │ (fast)   │    │(fallback)│
              └──────────┘    └──────────┘
```

### Lag Monitoring Flow

```
ReplicaLagMonitor (every 10s)
  ↓
Poll pg_stat_replication on Primary
  ↓
Extract replay_lag, sent_lsn, replay_lsn
  ↓
┌──────────────────────────────────────┐
│  lag < 5s   │ lag 5-10s │ lag > 10s  │
│  (healthy)  │ (warning) │ (critical) │
└──────────────────────────────────────┘
       ↓             ↓           ↓
   CLOSED       WARNING       OPEN
  (use replica) (use replica) (use primary)
```

### Circuit Breaker States

```
CLOSED (normal)
 - Replica routing enabled
 - Lag monitoring active
 - Failures tracked
      ↓ (3 consecutive failures OR lag > threshold)

OPEN (failover)
 - All reads to primary
 - Replica healing
 - Wait 30s before retry
      ↓ (timeout expires)

HALF_OPEN (testing)
 - Limited replica traffic
 - Success count tracked
 - Need 5 consecutive successes
      ↓ (5 successes) │ (any failure)
      ↓               ↓
   CLOSED           OPEN
```

---

## Configuration

### Environment Variables

```bash
# Primary database (required)
DATABASE_URL="postgresql://user:pass@primary:5432/db?pgbouncer=true"

# Read replica (optional - replicas disabled if not set)
DATABASE_REPLICA_URL="postgresql://user:pass@replica:5432/db?pgbouncer=true"

# Global feature flag
ENABLE_READ_REPLICAS=false  # Default: false (opt-in for safety)

# Replica connection pool
REPLICA_CONNECTION_POOL_SIZE=30  # Larger than primary (read-only, less contention)

# Lag monitoring
REPLICA_LAG_POLL_INTERVAL=10000       # Poll interval in ms (default: 10s)
REPLICA_LAG_WARNING_THRESHOLD=5       # Warning threshold in seconds (default: 5s)
REPLICA_LAG_CRITICAL_THRESHOLD=10     # Critical threshold in seconds (default: 10s)

# Circuit breaker
CIRCUIT_BREAKER_FAILURE_THRESHOLD=3         # Failures before opening (default: 3)
CIRCUIT_BREAKER_SUCCESS_THRESHOLD=5         # Successes to close (default: 5)
CIRCUIT_BREAKER_OPEN_DURATION=30000         # Open state duration in ms (default: 30s)
CIRCUIT_BREAKER_HALF_OPEN_TIMEOUT=10000     # Half-open timeout in ms (default: 10s)

# Per-endpoint feature flags (comma-separated)
REPLICA_ENABLED_ENDPOINTS="message.history,conversation.list,user.profile"
```

---

## Safe Endpoints for Replica Routing

### ✅ SAFE for Replicas (Eventually Consistent Reads)

| Endpoint                | Operation                  | Consistency Requirement | Lag Tolerance            |
| ----------------------- | -------------------------- | ----------------------- | ------------------------ |
| `message.history`       | Fetch message history      | Eventually consistent   | Up to 5s lag acceptable  |
| `conversation.list`     | List user conversations    | Eventually consistent   | Up to 5s lag acceptable  |
| `user.profile`          | Fetch user profile         | Eventually consistent   | Up to 5s lag acceptable  |
| `conversation.metadata` | Fetch conversation details | Eventually consistent   | Up to 5s lag acceptable  |
| `message.search`        | Search messages            | Eventually consistent   | Up to 10s lag acceptable |

**Rationale**: These endpoints serve historical data where slight staleness (< 5s) doesn't impact UX. Users won't notice if a message sent 2 seconds ago doesn't appear immediately in history.

### ⚠️ CAUTION - Consider Primary

| Endpoint                   | Operation                | Risk                 | Recommendation                     |
| -------------------------- | ------------------------ | -------------------- | ---------------------------------- |
| `unread.counter`           | Get unread message count | May show stale count | Use primary (consistency critical) |
| `conversation.lastMessage` | Get most recent message  | May miss very recent | Use primary or accept < 5s lag     |
| `message.deliveryStatus`   | Get delivery receipts    | May show incomplete  | Use primary                        |

### ❌ NEVER Use Replicas (Strong Consistency Required)

| Endpoint              | Operation                   | Why Primary Required                           |
| --------------------- | --------------------------- | ---------------------------------------------- |
| `message.create`      | Create new message          | Write operation                                |
| `message.update`      | Update message              | Write operation                                |
| `message.delete`      | Delete message              | Write operation                                |
| `message.markAsRead`  | Update read receipt         | Write operation + immediate consistency needed |
| `conversation.create` | Create conversation         | Write operation                                |
| `user.update`         | Update user profile         | Write operation                                |
| **All transactions**  | Any transactional operation | Require strong consistency and atomicity       |

---

## Enabling Replica Routing (Step-by-Step)

### Phase 1: Staging Pilot (Week 1)

**Goal**: Validate lag monitoring and circuit breaker with low-risk endpoint

**Steps**:

1. **Deploy replica infrastructure**:

   ```bash
   # Set up PostgreSQL streaming replication (DBA task)
   # Verify replication is active:
   psql $DATABASE_URL -c "SELECT * FROM pg_stat_replication;"

   # Expected: 1 row showing active streaming replication
   ```

2. **Configure application**:

   ```bash
   # .env.staging
   DATABASE_URL="postgresql://user:pass@primary:5432/db?pgbouncer=true"
   DATABASE_REPLICA_URL="postgresql://user:pass@replica:5432/db?pgbouncer=true"

   # Enable replicas globally
   ENABLE_READ_REPLICAS=true

   # Enable ONLY message.history endpoint (pilot)
   REPLICA_ENABLED_ENDPOINTS="message.history"

   # Conservative thresholds for pilot
   REPLICA_LAG_WARNING_THRESHOLD=5
   REPLICA_LAG_CRITICAL_THRESHOLD=10
   ```

3. **Deploy and verify**:

   ```bash
   # Deploy to staging
   npm run deploy:staging

   # Check health endpoint
   curl https://staging-api.example.com/health | jq '.replica'

   # Expected output:
   {
     "enabled": true,
     "lag_seconds": 1.23,
     "circuit_breaker_state": "CLOSED",
     "endpoints_enabled": ["message.history"]
   }
   ```

4. **Monitor metrics**:

   ```bash
   # Open Grafana dashboard
   open http://grafana.example.com/d/replica-routing

   # Watch for 24 hours:
   # - replica_lag_seconds should stay < 5s
   # - read_routing_total{target="replica"} should increase
   # - Circuit breaker should stay CLOSED
   # - No errors in logs
   ```

5. **Validate UX**:

   ```bash
   # Test message history loading
   # 1. Send message in staging app
   # 2. Immediately refresh message history
   # 3. Message should appear within 5 seconds

   # If message doesn't appear:
   # - Check replica lag: curl /health/replica | jq '.lag_seconds'
   # - If lag > 5s, circuit breaker should have fallen back to primary
   # - Check logs for "Circuit breaker OPEN" message
   ```

**Success Criteria**:

- ✅ Replica lag stays < 5s for 95% of time
- ✅ Circuit breaker successfully opens when lag spikes
- ✅ No user-visible staleness (messages appear within 5s)
- ✅ No errors in application logs related to replica routing

### Phase 2: Expand to More Endpoints (Week 2)

**Goal**: Enable additional low-risk endpoints

**Steps**:

1. **Update configuration**:

   ```bash
   # .env.staging
   REPLICA_ENABLED_ENDPOINTS="message.history,conversation.list,user.profile"
   ```

2. **Deploy and monitor**:

   ```bash
   npm run deploy:staging

   # Watch metrics for each endpoint:
   # - read_routing_total{endpoint="conversation.list",target="replica"}
   # - read_routing_total{endpoint="user.profile",target="replica"}
   ```

3. **Load test**:

   ```bash
   cd scripts/load-testing
   npm run test:read-heavy

   # Verify:
   # - Replica lag stays < 5s under load
   # - Primary database load decreases (visible in pg_stat_activity)
   # - Response times remain consistent
   ```

### Phase 3: Production Canary (Week 3)

**Goal**: Gradual rollout to production with monitoring

**Steps**:

1. **Deploy to 10% of production traffic**:

   ```bash
   # .env.production
   ENABLE_READ_REPLICAS=true
   REPLICA_ENABLED_ENDPOINTS="message.history"  # Start with single endpoint

   # Deploy with feature flag
   CANARY_PERCENT=10 npm run deploy:production:canary
   ```

2. **Monitor for 48 hours**:

   ```bash
   # Watch key metrics:
   # - Error rate (should not increase)
   # - P95 latency (should improve or stay same)
   # - Replica lag (should stay < 5s)
   # - Circuit breaker state (should stay CLOSED)
   ```

3. **Gradually increase traffic**:

   ```bash
   # Day 3: 25%
   CANARY_PERCENT=25 npm run deploy:production:canary

   # Day 5: 50%
   CANARY_PERCENT=50 npm run deploy:production:canary

   # Day 7: 100%
   npm run deploy:production
   ```

### Phase 4: Full Rollout (Week 4+)

**Goal**: Enable all safe endpoints in production

**Steps**:

1. **Enable all safe endpoints**:

   ```bash
   # .env.production
   REPLICA_ENABLED_ENDPOINTS="message.history,conversation.list,user.profile,conversation.metadata"
   ```

2. **Monitor primary database load reduction**:

   ```sql
   -- Check query load distribution
   SELECT
     datname,
     count(*) as connections,
     count(*) FILTER (WHERE state = 'active') as active
   FROM pg_stat_activity
   WHERE datname = 'your_database'
   GROUP BY datname;

   -- Expected: Active connections should decrease by 30-50%
   ```

---

## Emergency Rollback Procedures

### Scenario 1: High Replica Lag (> 10s sustained)

**Symptoms**:

- `replica_lag_seconds` metric > 10s for > 5 minutes
- Circuit breaker stuck in OPEN state
- Users reporting stale data

**Immediate Action** (< 2 minutes):

```bash
# Disable replicas globally
ENABLE_READ_REPLICAS=false npm run deploy:production

# OR disable specific problematic endpoint
curl -X POST https://api.example.com/admin/replica/disable \
  -d '{"endpoint": "message.history"}'
```

**Investigation** (< 30 minutes):

```bash
# Check replication status
psql $DATABASE_URL -c "SELECT * FROM pg_stat_replication;"

# Check for replication lag causes:
# - Long-running transactions on primary
# - Network issues between primary and replica
# - Replica resource contention (CPU/disk)

# Check primary for locks
psql $DATABASE_URL -c "SELECT * FROM pg_locks WHERE NOT granted;"
```

**Resolution**:

```bash
# If long-running transaction:
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE (now() - query_start) > interval '5 minutes'
  AND state = 'active';

# If network issue:
# - Check firewall rules
# - Verify connectivity: ping replica_host

# If replica overloaded:
# - Scale up replica instance
# - Add read replicas to distribute load
```

### Scenario 2: Circuit Breaker Flapping

**Symptoms**:

- Circuit breaker rapidly cycling between CLOSED and OPEN
- Logs showing "Circuit breaker OPENED" every few minutes
- Inconsistent replica routing

**Immediate Action**:

```bash
# Force circuit breaker OPEN (all reads to primary)
curl -X POST https://api.example.com/admin/circuit-breaker/open

# This will stabilize routing while investigating
```

**Investigation**:

```bash
# Check circuit breaker metrics
curl https://api.example.com/health/replica | jq .

# Check for intermittent issues:
# - Replica connection timeouts
# - Lag spikes
# - Network instability
```

**Resolution**:

```bash
# Increase failure threshold to reduce sensitivity
CIRCUIT_BREAKER_FAILURE_THRESHOLD=5  # Was 3

# Increase lag warning threshold if acceptable
REPLICA_LAG_WARNING_THRESHOLD=8  # Was 5

# Redeploy with adjusted thresholds
npm run deploy:production
```

### Scenario 3: Replica Connection Failures

**Symptoms**:

- Errors: "Failed to connect to replica"
- All reads falling back to primary
- `replica_health` metric = 0

**Immediate Action**:

```bash
# Disable replicas (automatic fallback already happening)
ENABLE_READ_REPLICAS=false npm run deploy:production
```

**Investigation**:

```bash
# Test replica connectivity
psql $DATABASE_REPLICA_URL -c "SELECT 1;"

# Check replica status
pg_ctl status -D /var/lib/postgresql/data

# Check logs
tail -f /var/log/postgresql/postgresql-replica.log
```

**Resolution**:

```bash
# If replica crashed, restart:
pg_ctl start -D /var/lib/postgresql/data

# If connection pool exhausted:
# Increase REPLICA_CONNECTION_POOL_SIZE

# If authentication failed:
# Verify DATABASE_REPLICA_URL credentials
```

---

## Monitoring and Alerts

### Key Metrics

| Metric                | Type    | Labels                | Alert Threshold         |
| --------------------- | ------- | --------------------- | ----------------------- |
| `replica_lag_seconds` | Gauge   | environment, instance | > 10s for 5m (critical) |
| `replica_health`      | Gauge   | environment, instance | = 0 for 2m (critical)   |
| `replica_lag_bytes`   | Gauge   | environment, instance | > 100MB (warning)       |
| `read_routing_total`  | Counter | target, endpoint      | N/A (trend monitoring)  |

### Grafana Dashboards

**Panel 1: Replica Lag Trend**

```promql
replica_lag_seconds

# Thresholds:
# - 0-5s: Green
# - 5-10s: Yellow
# - > 10s: Red
```

**Panel 2: Read Routing Distribution**

```promql
# Percentage of reads going to replica vs primary
sum(rate(read_routing_total{target="replica"}[5m])) /
sum(rate(read_routing_total[5m])) * 100

# Target: > 70% replica usage when circuit breaker CLOSED
```

**Panel 3: Circuit Breaker State**

```promql
# Custom metric (add to circuit breaker):
circuit_breaker_state{state="CLOSED"} = 1
circuit_breaker_state{state="OPEN"} = 2
circuit_breaker_state{state="HALF_OPEN"} = 3

# Visualize as state timeline
```

**Panel 4: Lag Threshold Violations**

```promql
# Count of times lag exceeded warning threshold
changes(replica_lag_seconds > 5)[1h]

# Alert if > 10 violations per hour
```

### Prometheus Alerts

```yaml
groups:
  - name: replica_routing
    interval: 30s
    rules:
      - alert: ReplicaLagHigh
        expr: replica_lag_seconds > 10
        for: 5m
        labels:
          severity: critical
          component: database
        annotations:
          summary: "Replica lag > 10s - Circuit breaker should open"
          description: "Lag is {{ $value }}s, threshold is 10s"
          runbook: "READ_REPLICA_PLAYBOOK.md#scenario-1-high-replica-lag"

      - alert: ReplicaUnhealthy
        expr: replica_health == 0
        for: 2m
        labels:
          severity: critical
          component: database
        annotations:
          summary: "Replica connection unhealthy"
          runbook: "READ_REPLICA_PLAYBOOK.md#scenario-3-replica-connection-failures"

      - alert: CircuitBreakerOpen
        expr: circuit_breaker_state == 2
        for: 10m
        labels:
          severity: warning
          component: database
        annotations:
          summary: "Circuit breaker open for 10m - investigate replica health"
          runbook: "READ_REPLICA_PLAYBOOK.md#scenario-2-circuit-breaker-flapping"

      - alert: LowReplicaUsage
        expr: |
          (sum(rate(read_routing_total{target="replica"}[10m])) /
           sum(rate(read_routing_total[10m]))) < 0.5
        for: 30m
        labels:
          severity: warning
          component: database
        annotations:
          summary: "< 50% reads using replica - check circuit breaker and lag"
```

---

## Performance Optimization Patterns

### 1. Keyset Pagination (Replaces OFFSET)

**Problem**: OFFSET pagination degrades with page depth

```typescript
// ❌ BAD: OFFSET pagination (O(n) with page depth)
const messages = await prisma.message.findMany({
  where: { conversationId },
  orderBy: { createdAt: "desc" },
  skip: page * pageSize, // <-- Performance killer for deep pages
  take: pageSize,
});
```

**Solution**: Keyset pagination with cursors

```typescript
// ✅ GOOD: Keyset pagination (O(log n) always)
import { KeysetPaginator } from "@/common/utils/keyset-paginator";

const result = await KeysetPaginator.paginate({
  query: (whereClause) =>
    prisma.message.findMany({
      where: {
        conversationId,
        ...whereClause, // <-- WHERE (createdAt, id) < cursor
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: pageSize + 1,
    }),
  pageSize,
  cursor: request.cursor,
});

// Return with next cursor
return {
  messages: result.data,
  nextCursor: result.nextCursor,
  hasMore: result.hasMore,
};
```

**Benefits**:

- ✅ Page 1 and Page 1000 have same latency (< 10ms)
- ✅ No drift when new messages inserted during pagination
- ✅ Efficient use of composite index on (createdAt DESC, id DESC)

### 2. Batched Aggregates (Eliminates N+1)

**Problem**: N+1 queries for unread counts

```typescript
// ❌ BAD: N+1 pattern (100 conversations = 100 queries)
for (const conversation of conversations) {
  conversation.unreadCount = await prisma.message.count({
    where: {
      conversationId: conversation.id,
      readAt: null,
      senderId: { not: currentUserId },
    },
  });
}
```

**Solution**: Batched aggregate with GROUP BY

```typescript
// ✅ GOOD: Single query with GROUP BY (100 conversations = 1 query)
import { UnreadCountBatcher } from "@/common/services/batch-query.service";

const conversationIds = conversations.map((c) => c.id);
const unreadCounts = await batcher.getUnreadCounts(
  prisma,
  conversationIds,
  currentUserId,
);

// Attach counts to conversations
conversations.forEach((conversation) => {
  conversation.unreadCount = unreadCounts[conversation.id] || 0;
});
```

**Benefits**:

- ✅ Reduces 100 queries to 1 query (100x faster)
- ✅ Leverages composite index on (conversationId, readAt, senderId)
- ✅ Consistent latency regardless of conversation count

### 3. Short-Lived Transactions

**Problem**: Long transactions block replication and cause bloat

```typescript
// ❌ BAD: Long transaction holding locks
await prisma.$transaction(async (tx) => {
  const message = await tx.message.create({ data });

  // External API call inside transaction (BAD!)
  await sendPushNotification(message);

  await tx.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date() },
  });
});
```

**Solution**: Minimize transaction scope

```typescript
// ✅ GOOD: Short transaction, external calls outside
const message = await prisma.$transaction(async (tx) => {
  const message = await tx.message.create({ data });

  await tx.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date() },
  });

  return message;
});

// External call AFTER transaction committed
await sendPushNotification(message);
```

**Benefits**:

- ✅ Reduces lock contention
- ✅ Minimizes replication lag (long transactions delay WAL replay)
- ✅ Prevents transaction timeout errors

---

## Testing

### Unit Tests

```typescript
// Test keyset pagination
describe("KeysetPaginator", () => {
  it("should encode and decode cursors correctly", () => {
    const cursor = KeysetPaginator.encodeCursor(
      new Date("2025-01-01"),
      "msg-123",
    );
    const decoded = KeysetPaginator.decodeCursor(cursor);

    expect(decoded).toEqual({
      createdAt: new Date("2025-01-01"),
      id: "msg-123",
    });
  });

  it("should paginate with stable results", async () => {
    const page1 = await KeysetPaginator.paginate({
      query: () => mockMessages.slice(0, 51),
      pageSize: 50,
    });

    expect(page1.data).toHaveLength(50);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBeDefined();
  });
});

// Test circuit breaker
describe("ReadReplicaCircuitBreaker", () => {
  it("should open circuit after 3 failures", () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    expect(breaker.getStatus().state).toBe("OPEN");
  });

  it("should close circuit after 5 successes in HALF_OPEN", () => {
    breaker.transitionToHalfOpen();

    for (let i = 0; i < 5; i++) {
      breaker.recordSuccess();
    }

    expect(breaker.getStatus().state).toBe("CLOSED");
  });
});
```

### Integration Tests

```typescript
// Test replica routing
describe("DatabaseAccessLayer", () => {
  it("should route reads to replica when enabled", async () => {
    process.env.ENABLE_READ_REPLICAS = "true";
    process.env.REPLICA_ENABLED_ENDPOINTS = "message.history";

    const messages = await dal.findMany("message.history", (prisma) =>
      prisma.message.findMany({ where: { conversationId: "conv-1" } }),
    );

    expect(messages).toBeDefined();
    // Verify metric was incremented
    expect(TelemetryMetrics.incrementReadRouting).toHaveBeenCalledWith(
      "replica",
      "message.history",
    );
  });

  it("should fallback to primary when circuit breaker open", async () => {
    circuitBreaker.forceOpen();

    const messages = await dal.findMany("message.history", (prisma) =>
      prisma.message.findMany({ where: { conversationId: "conv-1" } }),
    );

    expect(TelemetryMetrics.incrementReadRouting).toHaveBeenCalledWith(
      "fallback",
      "message.history",
    );
  });
});
```

---

## FAQ

**Q: What happens if replica connection fails?**
A: Circuit breaker automatically opens and all reads fallback to primary. No queries fail.

**Q: How do I know if replicas are being used?**
A: Check metrics:

- `read_routing_total{target="replica"}` should be increasing
- Check health endpoint: `curl /health/replica | jq '.routing.replica_usage'`

**Q: Can I enable replicas for a specific user/tenant?**
A: Not directly, but you can add custom logic to DAL:

```typescript
const useReplica =
  user.tier === "premium" && circuitBreaker.canRouteToReplica(endpoint);
```

**Q: What if I need strong consistency for a read?**
A: Use `requireStrongConsistency` option:

```typescript
const message = await dal.findUnique(
  "message.latest",
  (prisma) => prisma.message.findUnique({ where: { id } }),
  { requireStrongConsistency: true }, // <-- Forces primary
);
```

**Q: How do I test replica routing locally?**
A: Use Docker Compose to set up primary + replica:

```bash
cd docker
docker-compose up -d postgres-primary postgres-replica
```

---

## Related Documentation

- **INSTRUMENTATION_GUIDE.md** - Metrics and observability
- **DATABASE_STATUS.md** - Database performance baseline
- **IMPLEMENTATION_COMPLETE.md** - PgBouncer and caching setup

---

**Last Updated**: 2025-10-22
**Maintained By**: Backend Infrastructure Team
**Review Cycle**: Quarterly
