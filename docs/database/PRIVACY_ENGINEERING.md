# Privacy Engineering Guide

# Secure Production Shape Extraction & Synthetic Data Pipeline

**Version**: 1.0.0  
**Owner**: Data Privacy Engineering  
**Last Updated**: 2025-10-22

---

## Overview

This guide documents the privacy-first approach to extracting distribution metrics from production and generating synthetic datasets for performance validation.

**Core Principles**:

1. **Zero PII Export**: No personally identifiable information leaves production boundary
2. **Zero Plaintext Export**: No message content exported in readable form
3. **Irreversible Tokenization**: HMAC-SHA256 with production-only salt
4. **Minimal Surface**: Only aggregate distributions and shape metrics exported
5. **Time-Bounded Retention**: 90-day TTL on all extracted artifacts

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    PRODUCTION BOUNDARY                       │
│                                                              │
│  ┌──────────────┐                                           │
│  │   Postgres   │                                           │
│  │  Production  │                                           │
│  │     DB       │                                           │
│  └──────┬───────┘                                           │
│         │                                                    │
│         ▼                                                    │
│  ┌──────────────────────────┐                              │
│  │  Production Sampler      │                              │
│  │  (runs IN production)    │                              │
│  │                          │                              │
│  │  • HMAC tokenization     │                              │
│  │  • Content redaction     │                              │
│  │  • Aggregate histograms  │                              │
│  └──────┬───────────────────┘                              │
│         │                                                    │
│         ▼                                                    │
│  ┌──────────────────────────┐                              │
│  │   Metrics Pack (JSON)    │   ← ONLY THIS LEAVES         │
│  │  • Distributions         │                              │
│  │  • Percentiles           │                              │
│  │  • Anonymized counts     │                              │
│  └──────────────────────────┘                              │
└─────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│                   DEV/STAGING ENVIRONMENT                    │
│                                                              │
│  ┌──────────────────────────┐                              │
│  │  Synthetic Generator     │                              │
│  │  (uses metrics pack)     │                              │
│  │                          │                              │
│  │  • Seeded PRNG           │                              │
│  │  • Power-law generation  │                              │
│  │  • Gibberish content     │                              │
│  └──────┬───────────────────┘                              │
│         │                                                    │
│         ▼                                                    │
│  ┌──────────────────────────┐                              │
│  │  Synthetic Dataset       │                              │
│  │  • 5M–300M messages      │                              │
│  │  • Production shape      │                              │
│  │  • Zero real PII         │                              │
│  └──────┬───────────────────┘                              │
│         │                                                    │
│         ▼                                                    │
│  ┌──────────────────────────┐                              │
│  │  Performance Testing     │                              │
│  │  • EXPLAIN ANALYZE       │                              │
│  │  • Index validation      │                              │
│  │  • Query optimization    │                              │
│  └──────────────────────────┘                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Role 1: Data Privacy Engineer

### Mission

Run in-boundary shape extraction safely, compute distribution metrics without exporting PII.

### Execution Environment

- **Location**: Production VPC, inside database network
- **Access**: Read-only database credentials
- **Output**: Metrics pack JSON + mapping manifest JSON
- **Restrictions**: No SSH tunnels, no data exports to external systems

### Step 1: Setup

```bash
# On production jump host (authorized access only)
cd /opt/data-privacy-tools
git clone <repo> && cd college-id-signup-1

# Set production salt (stored in HashiCorp Vault or AWS Secrets Manager)
export ANONYMIZATION_SALT=$(vault read -field=salt secret/data-privacy/production-salt-v1)

# Verify salt is non-empty
if [ -z "$ANONYMIZATION_SALT" ]; then
  echo "FATAL: Production salt not found"
  exit 1
fi

# Install dependencies (isolated environment)
npm install --production
```

### Step 2: Run Shape Extraction

```bash
# Extract 30-day window (typical for quarterly baseline refresh)
ts-node scripts/synthetic-data/production-sampler.ts \
  --output /secure/storage/shape-metrics-$(date +%Y%m%d).json \
  --window-days 30

# Outputs:
# - shape-metrics-20251022.json (distributions, histograms, percentiles)
# - shape-metrics-20251022_mapping.json (tokenization metadata)
```

### Step 3: Validate Output

```bash
# Automated PII scan
./scripts/validate-no-pii.sh /secure/storage/shape-metrics-*.json

# Expected output:
# ✓ No email addresses found
# ✓ No personal names detected
# ✓ No message content present
# ✓ All tokens are 16-char hex (HMAC truncated)
```

### Step 4: Store Securely

```bash
# Upload to production-locked S3 bucket
aws s3 cp /secure/storage/shape-metrics-*.json \
  s3://company-data-privacy-artifacts/shape-metrics/ \
  --sse aws:kms \
  --sse-kms-key-id alias/data-privacy-key \
  --metadata "retention=90days,extracted=$(date -Iseconds)"

# Set lifecycle policy for 90-day auto-delete
aws s3api put-object-tagging \
  --bucket company-data-privacy-artifacts \
  --key shape-metrics/shape-metrics-20251022.json \
  --tagging "TagSet=[{Key=AutoDelete,Value=90days}]"
```

### Step 5: Document Extraction

```bash
# Generate compliance report
cat <<EOF > /secure/storage/extraction-report-$(date +%Y%m%d).md
# Production Shape Extraction Report

**Date**: $(date -Iseconds)
**Operator**: $(whoami)
**Window**: 30 days
**Output**: shape-metrics-20251022.json (245 KB)

## Privacy Compliance

- ✓ No PII exported
- ✓ No plaintext message content
- ✓ All tokens HMAC-SHA256 with production salt
- ✓ Irreversible transformations only
- ✓ Stored in production-locked S3 bucket
- ✓ 90-day TTL enforced
- ✓ Access limited to authorized builders (IAM policy: DataPrivacyReadOnly)

## Distribution Summary

- Users sampled: $(jq '.users.total_count' /secure/storage/shape-metrics-20251022.json)
- Conversations sampled: $(jq '.conversations.total_count' /secure/storage/shape-metrics-20251022.json)
- Messages sampled: $(jq '.messages.total_count' /secure/storage/shape-metrics-20251022.json)

## Sign-off

Privacy Officer: _________________________  Date: ___________
SRE Lead: _________________________  Date: ___________
EOF
```

---

## Role 2: Staff Data Engineer

### Mission

Build deterministic synthetic generator for large-scale performance datasets.

### Execution Environment

- **Location**: Dev/Staging environment (non-production)
- **Input**: Metrics pack JSON (from production sampler)
- **Output**: Synthetic dataset (users, conversations, messages, receipts)

### Step 1: Download Metrics Pack

```bash
# On dev workstation (authorized IAM role)
aws s3 cp s3://company-data-privacy-artifacts/shape-metrics/shape-metrics-20251022.json \
  ./scripts/synthetic-data/production-metrics.json \
  --profile data-privacy-readonly

# Verify integrity
sha256sum production-metrics.json
```

### Step 2: Configure Generation

```bash
# Calibrate distribution-spec.json with production metrics
cd scripts/synthetic-data

# Update spec with actual production values
jq --argfile prod production-metrics.json '
  .messages.content.text_length.mu = ($prod.messages.content_length_histogram | ... calculate actual mu) |
  .messages.inter_arrival.mean_lambda_peak = ($prod.messages.hourly_distribution | ... extract peak rate)
' distribution-spec.json > distribution-spec-calibrated.json
```

### Step 3: Generate Dataset

```bash
# Dev band (5M messages, local testing)
ts-node generator.ts \
  --band dev \
  --seed dev_$(date +%Y%m%d)_baseline

# Staging band (100M messages, CI/CD testing)
ts-node generator.ts \
  --band staging \
  --seed staging_$(date +%Y%m%d)_baseline

# Perf band (300M messages, index optimization validation)
ts-node generator.ts \
  --band perf \
  --seed perf_$(date +%Y%m%d)_baseline
```

### Step 4: Validate Reproducibility

```bash
# Same seed should produce identical dataset
ts-node generator.ts --band dev --seed reproducibility_test_20251022

# Count rows
psql $DATABASE_URL -c "SELECT COUNT(*) FROM messages;"
# Output: 5000000

# Re-run with same seed
npm run db:reset
ts-node generator.ts --band dev --seed reproducibility_test_20251022

# Count rows again
psql $DATABASE_URL -c "SELECT COUNT(*) FROM messages;"
# Output: 5000000 (identical)

# Hash check
psql $DATABASE_URL -c "SELECT md5(array_agg(id ORDER BY id)::text) FROM messages;"
# Output: <same hash>
```

### Step 5: Document Generation

```bash
# Generation metadata saved automatically to:
# scripts/synthetic-data/report_<band>_<timestamp>.json

# Archive seed for reproducibility
mkdir -p scripts/synthetic-data/seeds
echo "perf_20251022_baseline" > scripts/synthetic-data/seeds/perf_20251022.txt
git add scripts/synthetic-data/seeds/
git commit -m "chore: archive perf dataset seed for reproducibility"
```

---

## Role 3: Data Operations Engineer

### Mission

Load generated data efficiently with proper metadata tracking and cleanup utilities.

### Execution Environment

- **Location**: Staging/Perf environment (non-production)
- **Database**: Dedicated `perf_synthetic` schema or separate database
- **Safety**: NODE_ENV check enforced (prevents production runs)

### Step 1: Prepare Schema

```bash
# Ensure environment is non-production
export NODE_ENV=staging
export DATABASE_URL=postgresql://user:pass@perf-db.internal:5432/synthetic_perf

# Verify Prisma schema is clean
npx prisma migrate deploy
npx prisma generate
```

### Step 2: Load Dataset

```bash
# Generate dataset (if not already done)
ts-node scripts/synthetic-data/generator.ts \
  --band staging \
  --seed staging_20251022_baseline

# Load and validate
ts-node scripts/synthetic-data/loader.ts \
  --schema public \
  --config scripts/synthetic-data/report_staging_*.json

# Output:
# [Load] Starting load process...
# [Count] Row counts:
#   Users: 150,000
#   Conversations: 300,000
#   Messages: 100,000,000
# [Integrity] ✓ All referential integrity constraints satisfied
# [Load] ✓ Load completed in 487s
# [Metadata] ✓ Saved to docs/perf-data/run_1729612345.json
```

### Step 3: Verify Load Quality

```bash
# Check distribution matches spec
psql $DATABASE_URL <<EOF
-- Message distribution per conversation
WITH msg_counts AS (
  SELECT "conversationId", COUNT(*) as msg_count
  FROM messages
  GROUP BY "conversationId"
)
SELECT
  percentile_cont(0.50) WITHIN GROUP (ORDER BY msg_count) as p50,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY msg_count) as p95,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY msg_count) as p99
FROM msg_counts;

-- Expected (from distribution-spec.json):
-- p50: ~15, p95: ~500, p99: ~5000
EOF
```

### Step 4: Warm Up Database

```bash
# Prewarm buffer cache for realistic query performance
psql $DATABASE_URL <<EOF
SELECT pg_prewarm('messages');
SELECT pg_prewarm('conversations');
SELECT pg_prewarm('conversation_users');
SELECT pg_prewarm('message_reads');
EOF

# Update table statistics
psql $DATABASE_URL <<EOF
ANALYZE users;
ANALYZE conversations;
ANALYZE conversation_users;
ANALYZE messages;
ANALYZE message_reads;
ANALYZE attachments;
EOF
```

### Step 5: Teardown (When Done)

```bash
# After performance testing complete
./docs/perf-data/teardown.sh

# Confirm deletion
psql $DATABASE_URL -c "SELECT COUNT(*) FROM messages;"
# Output: 0
```

---

## Security & Compliance

### Access Controls

| Artifact          | Storage Location              | IAM Policy             | Retention |
| ----------------- | ----------------------------- | ---------------------- | --------- |
| Production Salt   | HashiCorp Vault               | `DataPrivacyVaultRead` | Permanent |
| Metrics Pack      | S3 (`data-privacy-artifacts`) | `DataPrivacyReadOnly`  | 90 days   |
| Mapping Manifest  | S3 (`data-privacy-artifacts`) | `DataPrivacyReadOnly`  | 90 days   |
| Synthetic Dataset | Staging DB                    | `StagingDBFullAccess`  | 30 days   |
| Load Metadata     | Git (`docs/perf-data`)        | Public within repo     | Permanent |

### PII Export Prevention

**Automated Checks**:

1. Regex scan for email patterns (`@`)
2. Regex scan for name patterns (`[A-Z][a-z]+ [A-Z][a-z]+`)
3. Content length check (no fields >100 chars in metrics pack)
4. Token format validation (exactly 16 hex chars)

**Manual Review**:

- Privacy officer reviews metrics pack before transfer
- SRE lead verifies no database snapshots exported

### Incident Response

If PII suspected in exported artifacts:

1. **Immediate**: Quarantine artifacts, revoke S3 access
2. **Within 1 hour**: Notify privacy officer and legal
3. **Within 24 hours**: Delete all copies, rotate production salt
4. **Within 7 days**: Root cause analysis, update procedures

---

## Operational Runbook

### Quarterly Baseline Refresh

**Trigger**: Every 90 days or before major releases

**Steps**:

1. Privacy engineer extracts fresh metrics pack (30-day window)
2. Data engineer calibrates distribution spec with new metrics
3. Data engineer regenerates staging/perf datasets
4. Database team re-runs baseline query captures
5. Archive old datasets and metrics (S3 lifecycle moves to Glacier)

**Owner**: Database Performance team  
**Approver**: Privacy officer + SRE lead

### Emergency Teardown

**Trigger**: Production data accidentally loaded, PII leak suspected

**Steps**:

```bash
# Immediate
./docs/perf-data/teardown.sh --force --no-confirm

# Verify
psql $DATABASE_URL -c "SELECT tablename, n_live_tup FROM pg_stat_user_tables WHERE schemaname='public';"

# Audit
aws s3 rm s3://company-data-privacy-artifacts/shape-metrics/ --recursive --dryrun
```

**Notification**: Slack `#incident-response`, email privacy@company.com

---

## Validation & Testing

### Unit Tests

```bash
# Test HMAC determinism
npm test -- production-sampler.spec.ts

# Test synthetic generator reproducibility
npm test -- generator.spec.ts

# Test loader integrity checks
npm test -- loader.spec.ts
```

### Integration Tests

```bash
# End-to-end workflow
./scripts/e2e-privacy-pipeline.sh

# Expected output:
# ✓ Production sampler: no PII exported
# ✓ Synthetic generator: reproducible with same seed
# ✓ Loader: referential integrity maintained
# ✓ Teardown: clean removal
```

---

## References

- **GDPR Compliance**: [internal wiki link]
- **CCPA Data Minimization**: [internal wiki link]
- **Synthetic Data Best Practices**: [NIST SP 800-188 Draft]
- **Production Sampler Code**: `scripts/synthetic-data/production-sampler.ts`
- **Synthetic Generator Code**: `scripts/synthetic-data/generator.ts`
- **Loader Code**: `scripts/synthetic-data/loader.ts`

---

## Changelog

| Date       | Change          | Author                   |
| ---------- | --------------- | ------------------------ |
| 2025-10-22 | Initial version | Data Privacy Engineering |

---

**For Questions**: Slack `#data-privacy-engineering` or email data-privacy@company.com
