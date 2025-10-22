# Synthetic Data Generation for Phase 2 Performance Validation

**Version**: 1.1.0  
**Owner**: Database Performance Engineering  
**Purpose**: Produce statistically realistic, PII-free datasets to validate Phase 2 improvements (indexes, pooling, caching)

---

## 🆕 What's New (v1.1.0)

**Production Shape Sampling & Calibration Suite** - Complete privacy-first hybrid data pipeline:

- ✅ **production-shape-sampler.ts** - Extract aggregate metrics from production (NO PII)
- ✅ **calibrate-generator.ts** - Fit parametric models (power-law, log-normal) to production shape
- ✅ **validate-fidelity.ts** - Statistical validation (Chi-Square, KS tests) for GO/NO-GO decisions
- ✅ **Full documentation** - See [PRODUCTION_SHAPE_SAMPLING.md](../../docs/PRODUCTION_SHAPE_SAMPLING.md) for complete workflow

**Quick Start with New Tools**:
```bash
# 1. Extract production shape (IN PRODUCTION, requires ANONYMIZATION_SALT)
ts-node production-shape-sampler.ts --output shape-metrics-prod.json

# 2. Calibrate generator (in dev)
ts-node calibrate-generator.ts --shape shape-metrics-prod.json

# 3. Validate fidelity
ts-node validate-fidelity.ts --shape shape-metrics-prod.json --tolerance 0.15
```

**Privacy Guarantee**: Only aggregate histograms, percentiles, and type distributions are exported. Zero PII.

---

## Overview

Phase 2 database optimizations (composite indexes, PgBouncer pooling, Redis caching) require validation on production-scale data exhibiting realistic skew, temporal patterns, and hot-spot behavior. This framework generates synthetic datasets across three bands:

| Band | Messages | Users | Purpose |
|------|----------|-------|---------|
| **Dev** | 5M | 5k | Local development, quick iteration |
| **Staging** | 100M | 150k | Pre-production validation, plan stability |
| **Perf** | 300M+ | 250k | Load testing, cache/pool tuning, scaling validation |

---

## Distribution Specification

### Statistical Properties

The generator matches production distributions observed via the shape sampler:

1. **User Distribution**
   - Username length: Normal(μ=12, σ=4)
   - Profile completeness: Beta(α=2, β=5) — skewed toward incomplete

2. **Conversation Mix**
   - 70% one-to-one (2 members)
   - 25% small groups (3–20 members, geometric distribution)
   - 5% large groups (21–256 members, power law α=2.5)

3. **Message Volume**
   - Per-conversation: Power law α=1.8, median ~15, p95 ~500
   - Heavy rooms: 2% of conversations with 10k+ messages each
   - Content length: Log-normal(μ=4.5, σ=1.2) — mean ~150 chars

4. **Temporal Patterns**
   - Inter-arrival: Exponential with diurnal modulation
   - Peak hours: 9–12, 18–21 UTC
   - Burst coefficient: 2.5× during peak

5. **Read Receipts**
   - Read rate: 82%
   - Immediate (<30s): 35%
   - Near-term (<1h): 40%
   - Delayed (hours–days): 15%
   - Never: 10%

Full specification: [`distribution-spec.json`](./distribution-spec.json)

---

## Usage

### Prerequisites

```bash
# Ensure Prisma client is generated
npx prisma generate

# Set up target database (use dedicated perf schema)
export DATABASE_URL="postgresql://user:pass@localhost:5432/chat_perf"
npx prisma migrate deploy
```

### Generate Dataset

```bash
cd scripts/synthetic-data

# Dev band (5M messages, ~30 min)
ts-node generator.ts --band dev --seed dev_20251022_baseline

# Staging band (100M messages, ~8 hours)
ts-node generator.ts --band staging --seed staging_20251022_baseline

# Perf band (300M+ messages, ~24 hours)
ts-node generator.ts --band perf --seed perf_20251022_baseline
```

**Seed format**: `{band}_{date}_{identifier}` — ensures reproducibility for exact regeneration.

### Monitor Progress

Generator emits progress logs:

```
[SyntheticGen] Initialized for band=dev, seed=dev_20251022_baseline
[Users] Generating 5000 users...
[Users] Generated 5000/5000
[Users] ✓ Complete: 5000 users
[Conversations] Generating 8000 conversations...
[Conversations] Generated 5000/8000
...
[Messages] Generated 2500000/5000000
[Report] ✓ Written to report_dev_1729590234.json
```

---

## Production Shape Sampling

**Security First**: Never export raw PII or plaintext content from production.

### Extract Anonymized Metrics

Run **inside the production network boundary** with proper salt:

```bash
# Set anonymization salt (production secret)
export ANONYMIZATION_SALT="<production-secret-salt>"

# Extract 30-day shape sample
ts-node production-sampler.ts \
  --output shape-metrics-prod-20251022.json \
  --window-days 30
```

### What Gets Exported

**Safe (exported)**:
- Histograms of message lengths, conversation sizes, inter-arrival times
- Aggregate percentiles (p50, p95, p99)
- Type distributions (1:1 vs group, media ratio)
- Temporal patterns (hourly activity, diurnal cycles)

**Never exported**:
- User IDs, usernames, emails
- Message content (only length distribution)
- Conversation names or metadata
- Any reversible tokens

### Calibrate Synthetic Generator

1. Review `shape-metrics-prod-*.json` histograms
2. Adjust `distribution-spec.json` parameters to match observed distributions
3. Regenerate datasets and validate fit via KS-test or chi-squared

---

## Validation Workflow

### 1. Baseline Query Plans

After loading synthetic data, capture EXPLAIN ANALYZE baselines:

```sql
-- Message history (hot path)
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, content, "senderId", "createdAt"
FROM messages
WHERE "conversationId" = '<sample-id>'
ORDER BY "createdAt" DESC
LIMIT 50;

-- Conversation list
EXPLAIN (ANALYZE, BUFFERS)
SELECT c.id, c.name, c."lastMessageAt"
FROM conversations c
JOIN conversation_users cu ON cu."conversationId" = c.id
WHERE cu."userId" = '<sample-user-id>'
  AND cu."isActive" = true
ORDER BY c."updatedAt" DESC
LIMIT 20;
```

**Checklist**:
- [ ] Record rows examined, heap fetches, sort nodes
- [ ] Note index usage (Seq Scan vs Index Scan)
- [ ] Capture timing: planning + execution
- [ ] Test with heavy-room conversations (10k+ messages)

### 2. Apply Phase 2 Changes

```sql
-- Composite index for message history
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_conversation_created_desc
ON messages ("conversationId", "createdAt" DESC);

-- Conversation activity index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_user_updated
ON conversation_users ("userId", "isActive")
INCLUDE ("conversationId");
```

### 3. Validate Improvements

Re-run EXPLAIN ANALYZE and compare:

**Expected Improvements**:
- ✅ No explicit `Sort` node for message history
- ✅ Index Scan replaces Seq Scan
- ✅ p95 latency drops 50–80%
- ✅ Heap fetches reduced (covering index)

**Regression Indicators**:
- ❌ Write amplification >20% (monitor insert latency)
- ❌ Index bloat (watch table/index size ratio)
- ❌ Plan instability (planner switches between scans)

---

## Dataset Lifecycle

### Storage

- **Dev**: Keep in local Postgres instance, drop/recreate as needed
- **Staging**: Persist in dedicated RDS/Cloud SQL instance, refresh monthly
- **Perf**: Maintain in isolated cluster, version with generation seed

### Refresh Cadence

| Band | Refresh Interval | Trigger |
|------|-----------------|---------|
| Dev | Ad-hoc | Schema changes, test iterations |
| Staging | Monthly | Schema migrations, distribution drift |
| Perf | Quarterly | Major release cycles, capacity planning |

### Cleanup

```bash
# Drop all synthetic data (use with caution)
psql $DATABASE_URL -c "TRUNCATE messages, conversations, users CASCADE;"

# Or drop entire perf database
dropdb chat_perf
```

---

## Troubleshooting

### Generation Too Slow

- Reduce batch sizes in `generator.ts` (lines 127, 263)
- Use faster disk (SSD/NVMe) for target database
- Increase `work_mem` for Postgres (allows larger sorts)
- Disable fsync temporarily for bulk load (restore after)

### Memory Exhaustion

- Lower `take` limits in sampler queries (lines 219, 274)
- Increase Node.js heap: `NODE_OPTIONS=--max-old-space-size=8192`
- Process in smaller time windows

### Unrealistic Distributions

- Re-run production sampler with longer window (`--window-days 90`)
- Adjust `distribution-spec.json` parameters
- Validate fit with statistical tests (KS, chi-squared)

---

## Security & Privacy

### Production Sampling Rules

1. **Never export raw data** — only aggregate shape metrics
2. **Require ANONYMIZATION_SALT** — enforced by sampler script
3. **Run inside production boundary** — no external network access
4. **Audit output files** — automated PII scan before export
5. **Rotate salt quarterly** — invalidates old anonymized tokens

### Incident Response

If PII is accidentally exported:

1. Delete output file immediately
2. Notify security team
3. Rotate ANONYMIZATION_SALT
4. Review access logs for breach scope
5. Document incident in post-mortem

---

## References

- **Distribution Spec**: [`distribution-spec.json`](./distribution-spec.json)
- **Generator**: [`generator.ts`](./generator.ts)
- **Production Sampler**: [`production-sampler.ts`](./production-sampler.ts)
- **Query Baseline Template**: `docs/database/baselines/query-catalog.md` (to be created)

---

**Next Steps**:

1. Generate dev dataset for local testing
2. Run baseline EXPLAIN ANALYZE on hot paths
3. Apply Phase 2 indexes
4. Validate improvements with before/after comparison
5. Scale to staging/perf bands for load testing

**Questions**: Contact Database Performance team (`#db-perf` Slack)
