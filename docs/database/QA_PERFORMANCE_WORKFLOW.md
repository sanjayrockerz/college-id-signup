# Data QA & Performance Verification Complete Workflow

**Version**: 1.0.0  
**Owner**: Data QA Engineering + Database Performance Team  
**Date**: 2025-10-22

---

## Overview

This guide documents the complete workflow for validating synthetic dataset fidelity and verifying index performance improvements before proceeding to Phase 2 pooling/caching optimizations.

**Two-Stage Gate**:

1. **Dataset Fidelity Validation** (QA Engineer) — GO/NO-GO before EXPLAIN
2. **Index Performance Verification** (DB Engineer) — GO/NO-GO before pooling/caching

---

## Stage 1: Dataset Fidelity Validation

### Purpose

Confirm that the loaded dataset's distributions match target specifications within tolerance bands. Skipping this check leads to misleading performance conclusions.

### Prerequisites

- Synthetic dataset loaded (dev/staging/perf band)
- Generation report available (`report_<band>_*.json`)

### Execution

```bash
# Validate dataset fidelity
cd scripts/synthetic-data

ts-node validate-dataset-fidelity.ts \
  --config report_staging_*.json \
  --tolerance 0.15

# Expected output:
# [Distribution] Validating conversation sizes...
#   1:1: 70.2% (expected 70%)
#   Small: 24.8% (expected 25%)
#   Large: 5.0% (expected 5%)
# [Distribution] Validating messages per conversation...
#   p50: 14 (expected ~15)
#   p95: 520 (expected ~500)
# ...
# === VALIDATION SUMMARY ===
# Decision: GO
# Rationale: Dataset distributions match target specs within tolerance.
```

### Validation Metrics

| Metric                        | Target                       | Tolerance | Critical? |
| ----------------------------- | ---------------------------- | --------- | --------- |
| **Conversation Mix**          | 70% 1:1, 25% small, 5% large | ±15%      | Yes       |
| **Messages per Conversation** | p50=15, p95=500, p99=5000    | ±30%      | No        |
| **Content Length**            | mean=150, median=90          | ±15%      | No        |
| **Media Ratio**               | 15%                          | ±5%       | Yes       |
| **Diurnal Pattern**           | Peak/trough ratio 2.5x       | ±30%      | No        |
| **Heavy Rooms**               | Top 2% = 30% traffic         | ±30%      | Yes       |

### Integrity Checks

1. **PII Absence**: No real emails, names, phone numbers
2. **Monotonic Timestamps**: Messages in each conversation have increasing `createdAt`
3. **Referential Integrity**: No orphaned messages, conversation members

### Decision Logic

**GO Criteria**:

- All critical metrics pass
- ≤3 warnings on non-critical metrics
- All integrity checks pass

**NO-GO Triggers**:

- Any critical metric fails
- > 3 warnings
- Any integrity violation

### Output

Report saved to: `docs/database/baselines/fidelity-report-<band>-<timestamp>.json`

**Example Report Structure**:

```json
{
  "summary": {
    "total_checks": 15,
    "passed": 14,
    "failed": 0,
    "warnings": 1,
    "go_no_go": "GO",
    "rationale": "Dataset distributions match target specs within tolerance."
  },
  "charts": {
    "conversation_size_histogram": {
      "2 (1:1)": 7020,
      "3-5": 1200,
      "6-10": 800,
      "11-20": 500,
      "21-50": 300,
      "100+": 180
    },
    "hourly_message_distribution": [120, 80, 50, ...],
    "heavy_room_traffic_share": 0.31
  }
}
```

---

## Stage 2: Index Performance Verification

### Purpose

Prove that composite indexes improve query latency at scale by eliminating Sort nodes and achieving Index Scan adoption.

### Prerequisites

- Dataset fidelity validation **PASSED**
- Synthetic dataset loaded and warmed up (`pg_prewarm`, `ANALYZE`)

### Phase A: Pre-Optimization Baseline

```bash
# Capture baseline BEFORE applying indexes
cd scripts/synthetic-data

ts-node verify-index-performance.ts --pre-optimization

# Expected output:
# [Q1_message_history] Message History (ORDER BY createdAt DESC LIMIT)
#   Execution: 142.35ms
#   Index: NO
#   Sort: YES ⚠️
#   Buffers: 350 hit / 120 read
# [Q3_conversation_list] Conversation List for User
#   Execution: 89.12ms
#   Index: NO
#   Sort: YES ⚠️
#   Buffers: 210 hit / 85 read
# ...
# === BASELINE SUMMARY ===
# Average execution: 98.45ms
# P95: 145.22ms
# Sorts present: 3
# Index adoption: 20%
```

**Baseline saved to**: `docs/database/baselines/pre-optimization/baseline-<timestamp>.json`

### Phase B: Apply Indexes

```sql
-- Connect to staging database
psql $DATABASE_URL

-- Create composite indexes (non-blocking)
CREATE INDEX CONCURRENTLY idx_messages_conversation_created_desc
  ON messages ("conversationId", "createdAt" DESC);

CREATE INDEX CONCURRENTLY idx_conversation_users_user_active
  ON conversation_users ("userId", "isActive")
  INCLUDE ("conversationId");

CREATE INDEX CONCURRENTLY idx_conversations_updated_desc
  ON conversations ("updatedAt" DESC);

-- Verify indexes created
\di+ idx_messages_conversation_created_desc

-- Update statistics
ANALYZE messages;
ANALYZE conversation_users;
ANALYZE conversations;
```

**Expected Duration**: 5-15 minutes for staging band (100M messages)

### Phase C: Post-Optimization Baseline

```bash
# Capture baseline AFTER applying indexes
ts-node verify-index-performance.ts --post-optimization

# Expected output:
# [Q1_message_history] Message History (ORDER BY createdAt DESC LIMIT)
#   Execution: 38.12ms ✓
#   Index: idx_messages_conversation_created_desc
#   Sort: NO ✓
#   Buffers: 85 hit / 12 read
# [Q3_conversation_list] Conversation List for User
#   Execution: 28.45ms ✓
#   Index: idx_conversation_users_user_active
#   Sort: NO ✓
#   Buffers: 45 hit / 8 read
# ...
# === BASELINE SUMMARY ===
# Average execution: 31.22ms
# P95: 45.18ms
# Sorts present: 0
# Index adoption: 100%
```

**Baseline saved to**: `docs/database/baselines/post-optimization/baseline-<timestamp>.json`

### Phase D: Comparison & Decision

```bash
# Compare pre vs post baselines
ts-node verify-index-performance.ts --compare \
  docs/database/baselines/pre-optimization/baseline-1729612345.json \
  docs/database/baselines/post-optimization/baseline-1729612567.json

# Expected output:
# [Q1_message_history] Message History (ORDER BY createdAt DESC LIMIT)
#   Pre:  142.35ms
#   Post: 38.12ms
#   Δ:    -104.23ms (-73.2%)
#   Sort: ELIMINATED ✓
#   Index: ADOPTED ✓
#
# [Q3_conversation_list] Conversation List for User
#   Pre:  89.12ms
#   Post: 28.45ms
#   Δ:    -60.67ms (-68.1%)
#   Sort: ELIMINATED ✓
#   Index: ADOPTED ✓
# ...
# === COMPARISON SUMMARY ===
# Average improvement: 68.5%
# P95 improvement: 68.9%
# Sorts eliminated: 3
# Queries improved: 5
# Queries degraded: 0
#
# Decision: GO
# Rationale: Index adoption successful. Average improvement 68.5%, p95 improvement 68.9%. Authorized to proceed to pooling/caching.
```

**Comparison saved to**: `docs/database/baselines/comparison-<timestamp>.json`

### Decision Logic

**GO Criteria**:

- Average improvement >30%
- P95 improvement >30%
- ≥60% of Sort nodes eliminated
- ≤1 query degraded
- All target queries adopt indexes

**NO-GO Triggers**:

- Average improvement <30%
- > 1 query significantly degraded (>20% slower)
- Sort nodes still present in ORDER BY queries
- Index not used despite creation

### Mitigation Recommendations

If specific queries don't improve:

| Issue              | Cause                 | Recommendation                                               |
| ------------------ | --------------------- | ------------------------------------------------------------ |
| Sort still present | Index direction wrong | Verify `DESC` in index matches `ORDER BY DESC`               |
| High heap reads    | Index not covering    | Add `INCLUDE (col1, col2)` to avoid heap lookups             |
| Index not used     | Low selectivity       | Check conversation size distribution; consider partial index |
| Write degradation  | Too many indexes      | Review write:read ratio; may need to drop less-used indexes  |

---

## Complete Workflow (End-to-End)

### Step-by-Step

```bash
# 1. Generate synthetic dataset
./scripts/quick-gen.sh staging staging_20251022_baseline

# 2. Validate dataset fidelity
cd scripts/synthetic-data
ts-node validate-dataset-fidelity.ts --config report_staging_*.json --tolerance 0.15

# GATE 1: If NO-GO, regenerate dataset with adjusted parameters
# If GO, proceed...

# 3. Warm up database
psql $DATABASE_URL <<EOF
SELECT pg_prewarm('messages');
SELECT pg_prewarm('conversations');
SELECT pg_prewarm('conversation_users');
ANALYZE messages;
ANALYZE conversations;
ANALYZE conversation_users;
EOF

# 4. Capture pre-optimization baseline
ts-node verify-index-performance.ts --pre-optimization

# 5. Apply indexes
psql $DATABASE_URL -f docs/database/indexes/phase-2-indexes.sql

# 6. Capture post-optimization baseline
ts-node verify-index-performance.ts --post-optimization

# 7. Compare and decide
ts-node verify-index-performance.ts --compare \
  docs/database/baselines/pre-optimization/baseline-*.json \
  docs/database/baselines/post-optimization/baseline-*.json

# GATE 2: If NO-GO, revise indexes
# If GO, proceed to Phase 3 (pooling/caching)
```

**Total Duration**: ~2 hours for staging band

---

## Troubleshooting

### Dataset Fidelity Fails

**Problem**: Conversation mix 60% 1:1 (expected 70%)

**Solution**:

```bash
# Adjust distribution-spec.json
jq '.conversations.type_distribution.one_to_one = 0.75' distribution-spec.json > distribution-spec-adjusted.json

# Regenerate
ts-node generator.ts --band staging --seed staging_20251022_adjusted
```

### Index Not Used

**Problem**: Query still does Seq Scan despite index

**Diagnosis**:

```sql
-- Check index visibility
SELECT * FROM pg_indexes WHERE tablename = 'messages';

-- Check query plan manually
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM messages WHERE "conversationId" = '<some-id>' ORDER BY "createdAt" DESC LIMIT 50;

-- Check statistics
SELECT * FROM pg_stats WHERE tablename = 'messages' AND attname = 'conversationId';
```

**Solution**:

- If index missing: Re-run `CREATE INDEX`
- If stats stale: Run `ANALYZE messages`
- If selectivity low: Add `WHERE` clause to index (partial index)

### High Heap Reads

**Problem**: Buffers show `shared_read` > `shared_hit`

**Solution**: Add covering index

```sql
CREATE INDEX CONCURRENTLY idx_messages_conversation_created_covering
  ON messages ("conversationId", "createdAt" DESC)
  INCLUDE (id, "senderId", type);  -- Columns in SELECT list
```

---

## Reporting

### Daily Standup Template

**Yesterday**:

- Generated staging dataset (100M messages)
- Validated fidelity: **GO** (14/15 checks passed)
- Captured pre-optimization baseline: p95 145ms, 3 sorts present

**Today**:

- Apply composite indexes on staging DB
- Capture post-optimization baseline
- Compare and generate decision report

**Blockers**:

- None

### Weekly Summary Template

**Week of 2025-10-22**:

- ✅ Dataset fidelity validation framework complete
- ✅ Index performance verification framework complete
- ✅ Staging dataset validated (GO decision)
- ✅ Pre-optimization baseline captured (p95: 145ms)
- ⏳ Indexes applied (in progress)
- ⏳ Post-optimization baseline (pending)

**Next Week**:

- Complete index verification
- Proceed to pooling/caching optimization (Phase 3)

---

## References

- **Dataset Fidelity Validator**: `scripts/synthetic-data/validate-dataset-fidelity.ts`
- **Index Performance Verifier**: `scripts/synthetic-data/verify-index-performance.ts`
- **Query Catalog**: `docs/database/baselines/query-catalog.md`
- **Distribution Spec**: `scripts/synthetic-data/distribution-spec.json`
- **Phase 2 Indexes**: `docs/database/indexes/phase-2-indexes.sql` (to be created)

---

## Changelog

| Date       | Change                           | Author                   |
| ---------- | -------------------------------- | ------------------------ |
| 2025-10-22 | Initial framework implementation | Data QA + DB Performance |

---

**For Questions**: Slack `#data-qa` or `#database-performance`  
**Review Cycle**: After each dataset generation or index change
