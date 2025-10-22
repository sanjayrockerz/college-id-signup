# Query Baseline Catalog

**Version**: 1.0.0  
**Date**: 2025-10-22  
**Purpose**: Enumerate hot-path queries with frequency, parameters, and performance targets for Phase 2 index/optimization validation

---

## Overview

This catalog identifies the highest-traffic read/write queries affecting user experience and establishes baseline performance metrics before Phase 2 optimizations (composite indexes, pooling, caching).

---

## Hot Path Inventory

### Query Classification

| Priority | Category            | Frequency   | Target p95 | Notes                   |
| -------- | ------------------- | ----------- | ---------- | ----------------------- |
| **P0**   | Message History     | 50k req/min | <50ms      | Dominant read path      |
| **P0**   | Message Insert      | 30k req/min | <100ms     | Write-heavy with fanout |
| **P1**   | Conversation List   | 20k req/min | <75ms      | User dashboard load     |
| **P1**   | Unread Count        | 15k req/min | <30ms      | Counter badge updates   |
| **P2**   | Read Receipt Update | 25k req/min | <80ms      | Batch-friendly          |
| **P2**   | Presence Lookup     | 10k req/min | <20ms      | Redis-cacheable         |

---

## Query Definitions

### Q1: Message History (P0)

**Description**: Fetch most recent N messages for a conversation (pagination).

**SQL Template**:

```sql
SELECT
  id,
  content,
  type,
  "senderId",
  "createdAt",
  "updatedAt"
FROM messages
WHERE "conversationId" = $1
ORDER BY "createdAt" DESC
LIMIT $2;
```

**Parameters**:

- `conversationId`: UUID (conversation identifier)
- `limit`: Integer (typically 20–100)

**Typical Workload**:

- 70% fetch last 50 messages
- 20% fetch 100+ for history scroll
- 10% target heavy rooms (10k+ messages)

**Performance Targets**:

- p50: <20ms
- p95: <50ms
- p99: <100ms

**Current Behavior (Pre-Optimization)**:

- Likely performs Seq Scan or index scan on `conversationId` followed by explicit Sort
- For large conversations, Sort node may spill to disk

**Expected Improvement**:

- Composite index `(conversationId, createdAt DESC)` eliminates Sort
- Index-only scan if covering (include `id`, `senderId`)

**Validation Query**:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, content, type, "senderId", "createdAt"
FROM messages
WHERE "conversationId" = '<heavy-room-id>'
ORDER BY "createdAt" DESC
LIMIT 50;
```

---

### Q2: Message Insert (P0)

**Description**: Insert new message with sender, content, conversation reference, and timestamp.

**SQL Template**:

```sql
INSERT INTO messages (
  id,
  "conversationId",
  "senderId",
  content,
  type,
  "createdAt",
  "updatedAt"
) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
RETURNING *;
```

**Parameters**:

- `conversationId`: UUID
- `senderId`: UUID
- `content`: Text (1–5000 chars)
- `type`: Enum (TEXT, MEDIA, SYSTEM)

**Typical Workload**:

- 85% TEXT messages
- 15% MEDIA (with attachment references)
- Burst patterns during peak hours (2.5× baseline)

**Performance Targets**:

- p50: <30ms
- p95: <100ms
- p99: <200ms

**Current Behavior**:

- Straightforward insert, but triggers index maintenance
- Hot conversations may cause index contention

**Expected Impact**:

- Adding `(conversationId, createdAt DESC)` index increases write amplification
- Monitor insert latency for regression >20%
- Consider partial index for recent messages if bloat occurs

**Validation Query**:

```sql
-- Measure insert latency under load
\timing on
INSERT INTO messages (...) VALUES (...);
```

---

### Q3: Conversation List (P1)

**Description**: Fetch user's active conversations ordered by recent activity.

**SQL Template**:

```sql
SELECT
  c.id,
  c.name,
  c.type,
  c."lastMessageAt",
  c."updatedAt"
FROM conversations c
JOIN conversation_users cu ON cu."conversationId" = c.id
WHERE cu."userId" = $1
  AND cu."isActive" = true
ORDER BY c."updatedAt" DESC
LIMIT $2;
```

**Parameters**:

- `userId`: UUID
- `limit`: Integer (typically 20–50)

**Typical Workload**:

- Dashboard load on app open
- Background refresh every 30–60s

**Performance Targets**:

- p50: <30ms
- p95: <75ms
- p99: <150ms

**Current Behavior**:

- Requires join on `conversation_users`
- May use Nested Loop or Hash Join depending on cardinality
- Sort on `updatedAt` may be expensive for users with many conversations

**Expected Improvement**:

- Index on `(userId, isActive)` with INCLUDE `(conversationId)` for covering scan
- Composite index on `conversations(updatedAt DESC)` for fast ordering

**Validation Query**:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT c.id, c.name, c."lastMessageAt"
FROM conversations c
JOIN conversation_users cu ON cu."conversationId" = c.id
WHERE cu."userId" = '<sample-user-id>'
  AND cu."isActive" = true
ORDER BY c."updatedAt" DESC
LIMIT 20;
```

---

### Q4: Unread Message Count (P1)

**Description**: Count messages in conversation since user's last read.

**SQL Template**:

```sql
SELECT COUNT(*)
FROM messages m
LEFT JOIN message_reads mr
  ON mr."messageId" = m.id
  AND mr."userId" = $1
WHERE m."conversationId" = $2
  AND m."createdAt" > COALESCE(
    (SELECT MAX("readAt") FROM message_reads WHERE "userId" = $1),
    '1970-01-01'
  )
  AND mr.id IS NULL;
```

**Parameters**:

- `userId`: UUID
- `conversationId`: UUID

**Typical Workload**:

- Polled for badge updates (every 15–30s per active user)
- High cardinality across conversations

**Performance Targets**:

- p50: <10ms
- p95: <30ms
- p99: <60ms

**Current Behavior**:

- Subquery may be inefficient for frequent polling
- LEFT JOIN pattern can cause planner confusion

**Expected Improvement**:

- Denormalize `lastReadAt` into `conversation_users` table
- Update on read receipt instead of querying on every poll
- Reduces query to simple comparison: `WHERE lastMessageAt > lastReadAt`

**Validation Query**:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT COUNT(*)
FROM messages m
LEFT JOIN message_reads mr ON ...
WHERE ...;
```

---

### Q5: Read Receipt Update (P2)

**Description**: Mark message(s) as read by user.

**SQL Template**:

```sql
INSERT INTO message_reads (
  id,
  "messageId",
  "userId",
  "readAt"
) VALUES ($1, $2, $3, NOW())
ON CONFLICT ("messageId", "userId")
DO UPDATE SET "readAt" = NOW();
```

**Parameters**:

- `messageId`: UUID (or array for batch)
- `userId`: UUID

**Typical Workload**:

- Batch updates (10–50 messages at once)
- Triggered on scroll-into-view or app focus

**Performance Targets**:

- p50: <40ms (batch of 20)
- p95: <80ms
- p99: <150ms

**Current Behavior**:

- UPSERT pattern with unique constraint check
- May cause lock contention on hot conversations

**Expected Improvement**:

- Index on `(messageId, userId)` (likely exists as PK/unique constraint)
- Batch upserts reduce round trips

**Validation Query**:

```sql
-- Batch insert timing
\timing on
INSERT INTO message_reads (...) VALUES
  (...),
  (...),
  ...
ON CONFLICT DO UPDATE ...;
```

---

### Q6: Presence Lookup (P2)

**Description**: Check which conversation members are currently online.

**SQL Template** (before caching):

```sql
SELECT
  cu."userId",
  u.username,
  u."profileImageUrl"
FROM conversation_users cu
JOIN users u ON u.id = cu."userId"
WHERE cu."conversationId" = $1
  AND cu."isActive" = true;
```

**Parameters**:

- `conversationId`: UUID

**Typical Workload**:

- Fetched on conversation open
- Refreshed every 30s for active conversations

**Performance Targets**:

- p50: <10ms (cached)
- p95: <20ms (cache miss, DB query)
- p99: <50ms

**Current Behavior**:

- Simple join, but frequent for active conversations
- High cache-hit potential (80%+ after warmup)

**Expected Improvement**:

- Redis cache with 60s TTL
- Presence heartbeat updates Redis directly
- DB fallback for cache misses only

**Validation Query**:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT cu."userId", u.username
FROM conversation_users cu
JOIN users u ON u.id = cu."userId"
WHERE cu."conversationId" = '<sample-conv-id>'
  AND cu."isActive" = true;
```

---

## Baseline Capture Procedure

### 1. Prepare Environment

```bash
# Load synthetic dataset (staging band recommended)
cd scripts/synthetic-data
ts-node generator.ts --band staging --seed baseline_20251022

# Warm up Postgres buffer cache
psql $DATABASE_URL -c "SELECT pg_prewarm('messages');"
psql $DATABASE_URL -c "SELECT pg_prewarm('conversations');"
```

### 2. Enable Query Logging

```sql
-- Enable pg_stat_statements
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Reset stats before baseline run
SELECT pg_stat_statements_reset();

-- Optional: Enable detailed logging
ALTER SYSTEM SET log_min_duration_statement = 50;
SELECT pg_reload_conf();
```

### 3. Capture Baselines

For each query in the catalog:

```sql
-- Template
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
<query>
```

**Save output** to `docs/database/baselines/pre-optimization/<query-id>.json`

**Extract key metrics**:

- Planning Time
- Execution Time
- Rows (actual vs estimated)
- Buffers Hit/Read/Dirtied
- Sort Method (if present)
- Index Name(s) used

### 4. Generate Report

```bash
# Summarize pg_stat_statements
psql $DATABASE_URL <<EOF
SELECT
  query,
  calls,
  mean_exec_time,
  stddev_exec_time,
  max_exec_time
FROM pg_stat_statements
WHERE query LIKE '%conversationId%'
ORDER BY calls DESC
LIMIT 20;
EOF
```

Save to `docs/database/baselines/pre-optimization/summary.txt`

---

## Post-Optimization Validation

### 1. Apply Indexes

```sql
-- See docs/database/indexes/phase-2-indexes.sql
CREATE INDEX CONCURRENTLY ...
```

### 2. Re-Capture Plans

Run same EXPLAIN ANALYZE queries, save to `post-optimization/` directory.

### 3. Compare Results

| Metric        | Pre   | Post | Δ          | Pass?           |
| ------------- | ----- | ---- | ---------- | --------------- |
| Q1 p95        | 120ms | 45ms | -62%       | ✅              |
| Q1 Sort Node  | Yes   | No   | Eliminated | ✅              |
| Q2 Insert p95 | 85ms  | 95ms | +12%       | ⚠️ (acceptable) |
| Q3 p95        | 180ms | 60ms | -67%       | ✅              |

**Acceptance Criteria**:

- ✅ Read queries meet target p95
- ✅ No new Sort/Hash nodes introduced
- ⚠️ Write latency increase <20%
- ❌ Index bloat ratio >3.0 (table_size / index_size)

---

## Maintenance

### Refresh Baselines

- **Trigger**: Schema changes, major data shape shifts
- **Frequency**: Quarterly or before major releases
- **Owner**: Database Performance team

### Archive Policy

- Keep pre/post optimization plans for 1 year
- Compress older baselines: `tar -czf baselines-2024.tar.gz 2024-*`

---

## References

- **Synthetic Data Generator**: `scripts/synthetic-data/README.md`
- **Phase 2 Index Spec**: `docs/database/indexes/phase-2-indexes.sql` (to be created)
- **Performance Dashboard**: Grafana `chat-db-performance` (UID: `chat-db-perf`)

---

**Next Steps**:

1. Generate staging dataset
2. Capture pre-optimization baselines for all P0/P1 queries
3. Apply Phase 2 indexes
4. Validate improvements meet targets
5. Document learnings in post-optimization report

**Owner**: Database Performance Engineering  
**Review**: SRE Lead, Backend Lead
