# Database Performance Baseline & Optimization Guide

## Overview

This guide provides a disciplined approach to establishing factual performance baselines for hot path queries and implementing measurable optimizations through indexing and denormalization.

**Goals:**

1. Capture EXPLAIN ANALYZE baselines for all high-traffic queries
2. Identify sequential scans, unnecessary sorts, and optimizer misestimates
3. Design and deploy composite indexes to eliminate waste
4. Denormalize unread counters to eliminate expensive anti-join queries
5. Measure before/after improvements objectively

---

## Phase 1: Query Catalog (✅ COMPLETE)

**Status:** Complete  
**Output:** `scripts/performance/db-baseline/01-query-catalog.md`

### Hot Paths Identified

| Query                 | Frequency     | Current p95 | Target p95 | Priority     |
| --------------------- | ------------- | ----------- | ---------- | ------------ |
| **Message History**   | 70% of reads  | ~24ms       | <15ms      | CRITICAL     |
| **Message Insert**    | 30% of writes | ~20ms       | <40ms      | MEDIUM       |
| **Conversation List** | 20% of reads  | ~40-60ms    | <30ms      | HIGH         |
| **Unread Counter**    | POLLING       | 50-200ms    | <10ms      | **CRITICAL** |
| **Participant Check** | 100% of ops   | ~5ms        | <2ms       | MEDIUM       |
| **Read Receipt**      | 15% of ops    | ~15ms       | <30ms      | LOW          |

**Key Finding:** Unread counter is #1 bottleneck with O(N×M) complexity.

---

## Phase 2: Capture Baselines

### Step 1: Ensure Representative Data

Before capturing baselines, seed the database with representative volumes:

```bash
# Check current data volumes
npm run db:baseline:capture -- --dry-run

# If needed, seed more data
npm run perf:seed-data
```

**Target Volumes:**

- Users: 1,000+
- Conversations: 500+
- Messages: 10,000+
- Message Reads: 50,000+
- Conversation Users: 2,000+

### Step 2: Run Baseline Capture

```bash
# Capture EXPLAIN ANALYZE for all hot paths
npm run db:baseline:capture
```

**Output:**

- JSON report: `docs/performance/baseline/baseline-{timestamp}.json`
- Console summary with critical findings

**What This Does:**

1. Connects to PostgreSQL via Prisma
2. Finds sample conversation and user data
3. Runs EXPLAIN ANALYZE for each hot path query
4. Parses query plans to detect:
   - Sequential scans
   - Explicit sort operations
   - Index usage (or lack thereof)
   - Nested loops and join strategies
5. Measures actual execution time
6. Generates comprehensive JSON report

### Step 3: Review Baseline Report

```bash
# View latest baseline
cat docs/performance/baseline/baseline-*.json | jq '.summary'

# Check for critical issues
cat docs/performance/baseline/baseline-*.json | jq '.queries[] | select(.findings.hasSeqScan == true or .findings.hasSort == true)'
```

**Expected Critical Findings:**

1. **Message History Query**: Sort operation detected (needs composite index)
2. **Unread Counter Query**: Sequential scan + anti-join (needs denormalization)
3. **Conversation List**: Possible nested loop (needs covering index)

---

## Phase 3: Index Design & Deployment

### Indexes Designed

1. **`idx_messages_conversation_created_desc`** (CRITICAL)
   - Composite: `(conversationId, createdAt DESC)`
   - Partial: `WHERE isDeleted = false`
   - Eliminates sort for message history queries

2. **`idx_conversation_users_user_active_conv`** (HIGH)
   - Composite: `(userId, isActive)`
   - Covering: `INCLUDE (conversationId, lastReadAt, role)`
   - Optimizes conversation list joins

3. **`idx_message_reads_message_user`** (MEDIUM)
   - Composite: `(messageId, userId)`
   - Partial: `WHERE readAt > NOW() - INTERVAL '30 days'`
   - Optimizes read receipt lookups

4. **`idx_messages_sender_created`** (MEDIUM)
   - Composite: `(senderId, createdAt DESC)`
   - Partial: `WHERE isDeleted = false`
   - Optimizes sender's message queries

5. **Additional indexes** for threads, participant verification

### Deployment Steps

#### Step 1: Review Index Design

```bash
# Read the SQL file
cat scripts/performance/db-baseline/02-index-design.sql
```

**Key Features:**

- All indexes use `CREATE INDEX CONCURRENTLY` (no table locks)
- Partial indexes reduce size and maintenance overhead
- Comments explain rationale and expected improvements
- Validation queries included

#### Step 2: Deploy Indexes (Safe for Production)

```bash
# Deploy all indexes
npm run db:baseline:indexes

# Or deploy manually with monitoring
psql "$DATABASE_URL" -f scripts/performance/db-baseline/02-index-design.sql
```

**Duration:** 5-15 minutes depending on data size  
**Downtime:** NONE (CONCURRENTLY creates indexes without locking)  
**Safety:** Safe to run in production during business hours

#### Step 3: Monitor Index Creation

```sql
-- Check index creation progress
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef,
  pg_size_pretty(pg_relation_size(indexrelid)) as size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND tablename IN ('messages', 'conversations', 'conversation_users')
ORDER BY pg_relation_size(indexrelid) DESC;
```

#### Step 4: Validate Index Usage

```bash
# Re-run baseline capture to measure improvements
npm run db:baseline:capture
```

**Expected Changes:**

- Message History: Sort node ELIMINATED ✅
- Conversation List: Index-only scan ✅
- Participant Check: Faster index lookup ✅

---

## Phase 4: Unread Counter Denormalization (CRITICAL)

### Problem

Current query scans ALL messages with expensive anti-join:

```sql
SELECT COUNT(*) FROM messages
WHERE conversationId IN (user's conversations)
  AND senderId != userId
  AND NOT EXISTS (SELECT 1 FROM message_reads WHERE ...)
```

**Impact:**

- 50-200ms latency (scales with message count)
- Cannot be efficiently indexed
- Polled every 5-10 seconds per user
- #1 database bottleneck under load

### Solution

Denormalize unread count into `conversation_users.unreadCount`:

```sql
-- New query (FAST)
SELECT SUM(unreadCount) FROM conversation_users WHERE userId = ?
```

**Impact:**

- <5ms latency (constant time)
- 90-95% reduction in query time
- Maintained via triggers on message insert/read

### Deployment Steps

#### Step 1: Review Denormalization Plan

```bash
cat scripts/performance/db-baseline/03-denormalize-unread-counts.sql
```

**What's Included:**

1. Add `unreadCount` column to `conversation_users`
2. Backfill existing counts (accurate calculation)
3. Create triggers to maintain counts on INSERT/UPDATE
4. Update application queries
5. Reconciliation function for data integrity

#### Step 2: Deploy Schema Changes

**⚠️ IMPORTANT:** Deploy during low-traffic period (backfill can take time)

```bash
# Option A: Full deployment
npm run db:baseline:denormalize

# Option B: Step-by-step with monitoring
psql "$DATABASE_URL"
\i scripts/performance/db-baseline/03-denormalize-unread-counts.sql
```

**Duration:** 10-30 minutes (depends on data size)  
**Downtime:** Minimal (column add is fast, backfill runs in transaction)

#### Step 3: Monitor Backfill Progress

```sql
-- Check backfill completion
SELECT
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE "unreadCount" > 0) as with_unread,
  AVG("unreadCount")::numeric(10,2) as avg_unread
FROM conversation_users
WHERE "isActive" = true;
```

#### Step 4: Update Application Code

**File:** `src/chat-backend/repositories/chat.repository.ts`

**Before:**

```typescript
async getUnreadMessageCount(userId: string): Promise<number> {
  // Expensive anti-join query
  const unreadCount = await this.db.message.count({
    where: {
      conversationId: { in: conversationIds },
      senderId: { not: userId },
      messageReads: { none: { userId } },
    },
  });
  return unreadCount;
}
```

**After:**

```typescript
async getUnreadMessageCount(userId: string): Promise<number> {
  // Fast aggregation query
  const result = await this.db.conversationUser.aggregate({
    where: {
      userId,
      isActive: true,
    },
    _sum: {
      unreadCount: true,
    },
  });
  return result._sum.unreadCount || 0;
}
```

**File:** `src/chat-backend/repositories/chat.repository.ts`

Update `markMessagesAsRead()` to decrement count:

```typescript
async markMessagesAsRead(conversationId, userId, messageIds) {
  return await this.db.$transaction(async (tx) => {
    // ... existing read receipt logic ...

    if (unreadMessageIds.length > 0) {
      // NEW: Decrement unread count
      await tx.conversationUser.update({
        where: {
          userId_conversationId: { userId, conversationId },
        },
        data: {
          unreadCount: { decrement: unreadMessageIds.length },
          updatedAt: new Date(),
        },
      });
    }

    return { markedAsRead: unreadMessageIds.length };
  });
}
```

#### Step 5: Deploy Application Changes

```bash
# Build and deploy updated application
npm run build
npm run start:prod

# Or for development
npm run start:dev
```

#### Step 6: Validate Accuracy

```sql
-- Run reconciliation to verify counts are accurate
SELECT * FROM reconcile_unread_counts() LIMIT 10;

-- Check for discrepancies
SELECT COUNT(*) as discrepancies
FROM reconcile_unread_counts()
WHERE ABS(diff) > 0;
```

**Expected:** 0-5% discrepancies initially (triggers catching up)

#### Step 7: Set Up Daily Reconciliation

**Option A: pg_cron (if available)**

```sql
SELECT cron.schedule(
  'reconcile-unread-counts',
  '0 3 * * *',  -- 3 AM daily
  'SELECT reconcile_unread_counts()'
);
```

**Option B: Node.js cron job (recommended)**

Create `src/jobs/reconcile-unread-counts.job.ts`:

```typescript
import { CronJob } from "cron";
import { getPrismaClient } from "../config/database";

export const reconcileUnreadCountsJob = new CronJob(
  "0 3 * * *", // 3 AM daily
  async () => {
    const prisma = getPrismaClient();
    console.log("Starting unread count reconciliation...");

    const result = await prisma.$queryRaw`
      SELECT * FROM reconcile_unread_counts()
    `;

    console.log(`Reconciled ${result.length} conversation_users`);
  },
  null,
  true,
  "America/New_York",
);
```

---

## Phase 5: Validation & Measurement

### Step 1: Re-Capture Baselines

```bash
# Capture post-optimization baselines
npm run db:baseline:capture
```

This generates a new baseline report with:

- Updated EXPLAIN ANALYZE plans
- Measured execution times
- Before/after comparison

### Step 2: Compare Results

```bash
# Get both baseline files
BEFORE=$(ls -t docs/performance/baseline/*.json | tail -n 1)
AFTER=$(ls -t docs/performance/baseline/*.json | head -n 1)

# Compare summary statistics
echo "=== BEFORE ==="
cat "$BEFORE" | jq '.summary'

echo "=== AFTER ==="
cat "$AFTER" | jq '.summary'

# Detailed query comparison
jq -s '
  {
    before: .[0].queries[] | select(.queryName == "Message History Query") | {name, time: .executionTimeMs, hasSort: .findings.hasSort},
    after: .[1].queries[] | select(.queryName == "Message History Query") | {name, time: .executionTimeMs, hasSort: .findings.hasSort}
  }
' "$BEFORE" "$AFTER"
```

### Step 3: Application-Level Testing

```bash
# Manual cache behavior test (includes database timing)
./test-cache-behavior.sh

# Load test (measures real-world performance)
k6 run tests/load/k6-full-stack.js
```

### Step 4: Monitor Production Metrics

**Key Metrics to Track:**

1. **Query Performance** (via Prometheus/Grafana)
   - `chat_message_history_latency_ms` (p50, p95, p99)
   - `chat_unread_count_latency_ms` (p50, p95, p99)
   - `chat_conversation_list_latency_ms` (p50, p95, p99)

2. **Database Metrics**
   - Index scan counts (should increase)
   - Sequential scan counts (should decrease to near-zero)
   - Sort operations (should decrease)
   - Buffer cache hit ratio (should remain > 99%)

3. **Write Performance**
   - Message insert latency (acceptable if < 30ms p95)
   - Message read update latency (should remain stable)

4. **Data Integrity**
   - Unread count accuracy (via daily reconciliation)
   - No negative counts
   - Drift < 1% after 24 hours

---

## Expected Results

### Message History Query

| Metric          | Before     | After   | Improvement   |
| --------------- | ---------- | ------- | ------------- |
| **p50 Latency** | 20ms       | 12ms    | 40%           |
| **p95 Latency** | 24ms       | 14ms    | 42%           |
| **Has Sort**    | ✅ YES     | ❌ NO   | ✅ Eliminated |
| **Index Used**  | ❌ Partial | ✅ Full | ✅ Optimal    |

### Unread Counter Query

| Metric          | Before | After | Improvement   |
| --------------- | ------ | ----- | ------------- |
| **p50 Latency** | 80ms   | 3ms   | 96%           |
| **p95 Latency** | 150ms  | 5ms   | 97%           |
| **Complexity**  | O(N×M) | O(1)  | ✅ Constant   |
| **Anti-Join**   | ✅ YES | ❌ NO | ✅ Eliminated |

### Conversation List Query

| Metric           | Before | After | Improvement       |
| ---------------- | ------ | ----- | ----------------- |
| **p50 Latency**  | 35ms   | 20ms  | 43%               |
| **p95 Latency**  | 55ms   | 30ms  | 45%               |
| **Heap Fetches** | High   | Low   | ✅ Covering Index |

### Overall Impact

- **Read Query p95**: 40-50% faster on average
- **Write Query p95**: 10-15% slower (acceptable tradeoff)
- **Database Load**: 60-70% reduction in sequential scans
- **Scalability**: 2-3x capacity increase with same infrastructure

---

## Troubleshooting

### Issue: Index Creation Timeout

**Symptom:** `CREATE INDEX CONCURRENTLY` hangs or times out

**Solution:**

```sql
-- Check for blocking queries
SELECT * FROM pg_stat_activity
WHERE state = 'active' AND query LIKE '%CREATE INDEX%';

-- Increase maintenance_work_mem temporarily
SET maintenance_work_mem = '1GB';

-- Then retry index creation
```

### Issue: Unread Counts Drift

**Symptom:** `reconcile_unread_counts()` shows high drift (>5%)

**Solution:**

```sql
-- Full reconciliation for all users
SELECT * FROM reconcile_unread_counts();

-- Check trigger status
SELECT tgname, tgenabled FROM pg_trigger
WHERE tgrelid = 'messages'::regclass;

-- Re-enable triggers if disabled
ALTER TABLE messages ENABLE TRIGGER trg_increment_unread_on_message_insert;
```

### Issue: Slow Backfill

**Symptom:** Unread count backfill takes > 30 minutes

**Solution:**

```bash
# Use incremental backfill (commented in migration script)
# Edit scripts/performance/db-baseline/03-denormalize-unread-counts.sql
# Uncomment "Option B: Incremental backfill"
# Adjust batch_size to 500 for faster processing
```

### Issue: Application Using Old Query

**Symptom:** Unread counter still slow after deployment

**Solution:**

```bash
# Verify application code was updated
grep -n "getUnreadMessageCount" src/chat-backend/repositories/chat.repository.ts

# Check deployed code matches expected implementation
# Restart application to ensure new code is running
npm run start:prod
```

---

## Rollback Procedures

### Rollback Indexes

```bash
# Rollback script included in 02-index-design.sql
psql "$DATABASE_URL" << 'EOF'
DROP INDEX CONCURRENTLY IF EXISTS idx_messages_conversation_created_desc;
DROP INDEX CONCURRENTLY IF EXISTS idx_conversation_users_user_active_conv;
-- ... (see full script for all indexes)
EOF
```

**Safe to rollback:** Yes, no application code changes needed

### Rollback Denormalization

```bash
# Rollback script included in 03-denormalize-unread-counts.sql
psql "$DATABASE_URL" << 'EOF'
DROP TRIGGER IF EXISTS trg_increment_unread_on_message_insert ON messages;
DROP TRIGGER IF EXISTS trg_adjust_unread_on_message_update ON messages;
DROP FUNCTION IF EXISTS increment_unread_counts();
ALTER TABLE conversation_users DROP COLUMN IF EXISTS "unreadCount";
EOF
```

**⚠️ Requires application rollback:** Yes, revert changes to `ChatRepository`

---

## Maintenance & Monitoring

### Daily Tasks

1. **Run Reconciliation** (automated via cron)

   ```sql
   SELECT * FROM reconcile_unread_counts();
   ```

2. **Check Index Usage**

   ```sql
   SELECT * FROM vw_index_usage
   WHERE tablename IN ('messages', 'conversations', 'conversation_users')
   ORDER BY scans DESC;
   ```

3. **Monitor Drift**
   ```sql
   SELECT * FROM vw_unread_count_stats;
   ```

### Weekly Tasks

1. **Analyze Tables**

   ```sql
   ANALYZE messages;
   ANALYZE conversation_users;
   ```

2. **Check Index Bloat**
   ```sql
   SELECT schemaname, tablename, indexname,
     pg_size_pretty(pg_relation_size(indexrelid)) as size
   FROM pg_stat_user_indexes
   WHERE schemaname = 'public'
   ORDER BY pg_relation_size(indexrelid) DESC
   LIMIT 20;
   ```

### Monthly Tasks

1. **Review Query Plans**

   ```bash
   npm run db:baseline:capture
   # Compare with previous month's baseline
   ```

2. **Vacuum Analysis**
   ```sql
   SELECT schemaname, tablename, n_dead_tup, n_mod_since_analyze
   FROM pg_stat_user_tables
   WHERE schemaname = 'public'
   ORDER BY n_dead_tup DESC;
   ```

---

## Success Criteria

- ✅ All targeted queries have reproducible baselines
- ✅ Clear hypotheses for optimization improvements
- ✅ Message history query eliminates sort operation
- ✅ Unread counter query < 10ms p95
- ✅ No regressions in write performance (< 30ms p95)
- ✅ Application code updated and tested
- ✅ Daily reconciliation scheduled
- ✅ Monitoring dashboards updated

---

## References

- **Query Catalog**: `scripts/performance/db-baseline/01-query-catalog.md`
- **Index Design**: `scripts/performance/db-baseline/02-index-design.sql`
- **Denormalization**: `scripts/performance/db-baseline/03-denormalize-unread-counts.sql`
- **Baseline Capture**: `scripts/performance/db-baseline/capture-baseline.ts`
- **Prisma Schema**: `prisma/schema.prisma`

---

**Generated**: October 22, 2025  
**Status**: Ready for execution  
**Next Steps**: Run `npm run db:baseline:capture` to begin
