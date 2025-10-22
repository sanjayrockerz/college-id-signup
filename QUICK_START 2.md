# 🚀 Quick Start: Generate Your First Synthetic Dataset

**Status**: No datasets generated yet  
**Next Step**: Generate dev dataset (5M messages, ~30 min)

---

## Current Situation

You ran:

```bash
ts-node validate-dataset-fidelity.ts --config report_dev_*.json --tolerance 0.15
```

But got an error because **no generation report exists yet**. You need to generate data first!

---

## Option 1: Quick Generation (No Production Access)

**Use pre-configured distribution spec** (already optimized for production-like behavior):

```bash
cd /Users/harishraghave/Desktop/colleging/college-id-signup-1

# Generate dev dataset (5M messages, ~30 minutes)
./scripts/quick-gen.sh dev dev_baseline_20251022_v1
```

**What this does**:

1. Creates 5,000 users
2. Creates 8,000 conversations (70% 1:1, 25% small groups, 5% large)
3. Generates 5M messages with:
   - Power-law distribution (median 15 msgs/convo, p95 500)
   - 15% media ratio (images, videos, docs)
   - Diurnal patterns (2.5× peak vs trough)
   - Heavy rooms (2% of conversations, 30% of traffic)
4. Creates ~4.1M read receipts (82% read rate)
5. Saves report to: `scripts/synthetic-data/report_dev_<timestamp>.json`

---

## Option 2: Production-Calibrated Generation (With Production Access)

**Extract shape from production, calibrate generator, then generate**:

### Step 1: Extract Production Shape (5-15 min)

```bash
# Connect to production network
ssh bastion.prod.example.com

# Set anonymization salt (from secrets manager)
export ANONYMIZATION_SALT="$(aws secretsmanager get-secret-value \
  --secret-id prod/shape-sampler/salt \
  --query SecretString --output text)"

# Extract shape metrics (aggregate only, NO PII)
cd /app/college-id-signup-1/scripts/synthetic-data
ts-node production-sampler.ts \
  --output shape-metrics-prod-20251022.json \
  --window-days 30

# Validate no PII exported
ts-node validate-no-pii.ts --input shape-metrics-prod-20251022.json

# Copy to dev environment (securely)
scp shape-metrics-prod-20251022.json dev.example.com:~/shape-metrics/
```

### Step 2: Calibrate Generator (5 min)

```bash
# Switch to dev environment
cd /Users/harishraghave/Desktop/colleging/college-id-signup-1/scripts/synthetic-data

# Fit parametric distributions from production shape
ts-node calibrate-from-production.ts \
  ~/shape-metrics/shape-metrics-prod-20251022.json \
  calibration-report-20251022.json

# Update generator config
jq --argfile cal calibration-report-20251022.json '
  .conversations.type_distribution = $cal.fitted_distributions.conversation_sizes.type_mix |
  .messages.per_conversation_distribution.alpha = $cal.fitted_distributions.messages_per_conversation.alpha |
  .messages.content.text_length.mu = $cal.fitted_distributions.content_length.mu |
  .messages.content.text_length.sigma = $cal.fitted_distributions.content_length.sigma
' distribution-spec.json > distribution-spec-calibrated.json
```

### Step 3: Generate Calibrated Dataset (30 min)

```bash
ts-node generator.ts \
  --band dev \
  --seed dev_calibrated_20251022 \
  --config distribution-spec-calibrated.json
```

---

## After Generation: Validate Fidelity

Once generation completes, validate the dataset:

```bash
cd scripts/synthetic-data

# Validate dataset distributions match target specs
ts-node validate-dataset-fidelity.ts \
  --config report_dev_*.json \
  --tolerance 0.15

# Expected output:
# [Distribution] Validating conversation sizes...
#   1:1: 70.2% (expected 70%) ✓
#   Small: 24.8% (expected 25%) ✓
# ...
# === VALIDATION SUMMARY ===
# Decision: GO
```

---

## Recommended Path for You

**Start with Option 1** (no production access required):

```bash
# 1. Generate dev dataset
cd /Users/harishraghave/Desktop/colleging/college-id-signup-1
./scripts/quick-gen.sh dev dev_baseline_20251022_v1

# 2. Wait ~30 minutes for completion

# 3. Validate fidelity
cd scripts/synthetic-data
ts-node validate-dataset-fidelity.ts --config report_dev_*.json --tolerance 0.15

# 4. If GO, proceed to index testing
ts-node verify-index-performance.ts --pre-optimization

# 5. Apply indexes
psql $DATABASE_URL -f ../../docs/database/indexes/phase-2-indexes.sql

# 6. Capture post-optimization baseline
ts-node verify-index-performance.ts --post-optimization

# 7. Compare
ts-node verify-index-performance.ts --compare \
  ../../docs/database/baselines/pre-optimization/baseline-*.json \
  ../../docs/database/baselines/post-optimization/baseline-*.json
```

---

## Prerequisites

Before running generator:

### 1. Database Setup

```bash
# Create dedicated perf database
export DATABASE_URL="postgresql://localhost:5432/chat_perf"
createdb chat_perf

# Run migrations
cd /Users/harishraghave/Desktop/colleging/college-id-signup-1
npx prisma migrate deploy

# Verify connection
psql $DATABASE_URL -c "SELECT version();"
```

### 2. Prisma Client

```bash
# Generate Prisma client
npx prisma generate

# Verify
node -e "const { PrismaClient } = require('@prisma/client'); console.log('✓ Prisma client ready');"
```

### 3. Node.js Memory

For large datasets, increase heap size:

```bash
export NODE_OPTIONS="--max-old-space-size=4096"
```

---

## Troubleshooting

### Generator not found

```bash
# Make sure quick-gen.sh is executable
chmod +x scripts/quick-gen.sh

# Or run generator directly
cd scripts/synthetic-data
ts-node generator.ts --band dev --seed dev_baseline_20251022
```

### Database connection error

```bash
# Check DATABASE_URL is set
echo $DATABASE_URL

# Test connection
psql $DATABASE_URL -c "SELECT 1;"

# If no database, create one
createdb chat_perf
```

### Out of memory

```bash
# Increase Node.js heap
export NODE_OPTIONS="--max-old-space-size=8192"

# Or reduce batch size in generator.ts (line 127)
```

---

## Expected Timeline

| Band    | Messages | Duration  | Disk   |
| ------- | -------- | --------- | ------ |
| Dev     | 5M       | ~30 min   | ~2GB   |
| Staging | 100M     | ~8 hours  | ~45GB  |
| Perf    | 300M+    | ~24 hours | ~150GB |

---

## Next Command

**Run this now**:

```bash
cd /Users/harishraghave/Desktop/colleging/college-id-signup-1
./scripts/quick-gen.sh dev dev_baseline_20251022_v1
```

This will generate your first dataset using the pre-configured distribution spec (no production access needed). After it completes, you can validate fidelity and proceed to index testing.

---

## Documentation

- **Complete Status**: `SYNTHETIC_DATA_STATUS.md`
- **Production Sampling**: `docs/PRODUCTION_SHAPE_SAMPLING_GUIDE.md`
- **QA Workflow**: `docs/database/QA_PERFORMANCE_WORKFLOW.md`
- **Generator README**: `scripts/synthetic-data/README.md`

**Status**: 🟡 **READY TO GENERATE** - Run quick-gen.sh to start
