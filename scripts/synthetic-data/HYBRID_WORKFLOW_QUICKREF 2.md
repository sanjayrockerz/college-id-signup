# Hybrid Production-Synthetic Data Pipeline - Quick Reference

## 🎯 One-Page Workflow

### Phase 1: Extract Production Shape (IN PRODUCTION)

```bash
# Set production secret (retrieve from secrets manager)
export ANONYMIZATION_SALT="$(aws secretsmanager get-secret-value \
  --secret-id prod/sampler/salt --query SecretString --output text)"

# Extract aggregate metrics (NO PII exported)
cd /app/scripts/synthetic-data
ts-node production-shape-sampler.ts \
  --output shape-metrics-prod-$(date +%Y%m%d).json \
  --window-days 30

# ✅ Output: shape-metrics-prod-YYYYMMDD.json (SAFE TO EXPORT)
```

**Privacy Check**: Ensure output contains ONLY:
- ✅ Histograms (bucketed counts)
- ✅ Percentiles (p50, p90, p99)
- ✅ Type distributions (aggregates)
- ❌ NO user IDs, emails, message content, or identifiers

---

### Phase 2: Calibrate Generator (IN DEV)

```bash
# Fit parametric models to production shape
ts-node calibrate-generator.ts \
  --shape shape-metrics-prod-20251022.json \
  --output calibrated-config-20251022.json

# ✅ Output: calibrated-config-20251022.json (generator parameters)
```

**Result**: Power-law alpha, log-normal params, type distributions tuned to production.

---

### Phase 3: Generate Pilot Dataset

```bash
# Option A: Use quick-generator (recommended for first test)
NODE_OPTIONS="--max-old-space-size=4096" \
  npx ts-node quick-generator.ts

# Option B: Use full generator with calibrated config (future enhancement)
NODE_OPTIONS="--max-old-space-size=4096" \
  npx ts-node generator.ts \
    --band dev \
    --seed dev_calibrated_20251022 \
    --config calibrated-config-20251022.json
```

**Output**: 500K-5M messages in dev database

---

### Phase 4: Validate Fidelity

```bash
# Compare synthetic vs production distributions
ts-node validate-fidelity.ts \
  --shape shape-metrics-prod-20251022.json \
  --tolerance 0.15 \
  --output fidelity-report-20251022.json

# ✅ Output: fidelity-report-20251022.json (GO/NO-GO decision)
```

**Success Criteria**:
- Overall verdict: `PASS`
- All tests pass (4/4) or 3/4 with `WARNING`
- Max error < 15% (configurable with `--tolerance`)

---

### Phase 5: Iterate if Needed

**If fidelity validation FAILS**:

```bash
# 1. Check which test failed
cat fidelity-report-20251022.json | jq '.tests'

# 2. Adjust parameters in calibrated-config.json
#    - Lower alpha → heavier tail (more huge rooms)
#    - Higher alpha → shorter tail (fewer huge rooms)
#    - Adjust type distribution weights directly

# 3. Regenerate
NODE_OPTIONS="--max-old-space-size=4096" npx ts-node quick-generator.ts

# 4. Re-validate
ts-node validate-fidelity.ts \
  --shape shape-metrics-prod-20251022.json \
  --output fidelity-report-20251022-v2.json
```

**Iterate until**: Overall verdict = `PASS`

---

## 🔒 Privacy Guarantees

| What's Exported | What's NEVER Exported |
|-----------------|----------------------|
| ✅ Histogram buckets ("100-149 chars": 523 msgs) | ❌ User IDs, emails, usernames |
| ✅ Percentiles (p90 msgs/convo = 450) | ❌ Message content (plaintext or encrypted) |
| ✅ Type distributions (TEXT: 85%, IMAGE: 10%) | ❌ Conversation names or metadata |
| ✅ Temporal aggregates (hourly/daily) | ❌ Attachment URLs or filenames |
| ✅ Statistical params (mean, median, stddev) | ❌ IP addresses, tokens, session data |

**Privacy Level**: `ANONYMIZED_SHAPE_ONLY`

---

## 📊 Validation Tests

| Test | Method | Threshold | What It Validates |
|------|--------|-----------|-------------------|
| Conversation types | Chi-Square | p-value > 0.05 | DM vs Group ratio matches |
| Messages per convo | KS Statistic | Error < 15% | Power-law tail matches production |
| Message types | Chi-Square | p-value > 0.05 | TEXT/IMAGE/FILE ratio matches |
| Content length | Error % | Mean & median < 15% | Message sizes match |

---

## 🎓 Key Concepts

### Power-Law Distribution (Messages per Conversation)
- **Alpha = 1.5**: Very heavy tail (lots of huge rooms)
- **Alpha = 2.0**: Moderate tail (realistic production)
- **Alpha = 2.5**: Light tail (mostly small rooms)

**Production typically**: α ≈ 1.8-2.0 (some huge rooms, many small)

### Fidelity Tolerance
- **0.10 (±10%)**: Strict (hard to achieve)
- **0.15 (±15%)**: Recommended (balanced)
- **0.20 (±20%)**: Lenient (acceptable for initial tests)

---

## 📁 File Structure

```
scripts/synthetic-data/
├── production-shape-sampler.ts    # Step 1: Extract (prod only)
├── calibrate-generator.ts          # Step 2: Calibrate (dev)
├── validate-fidelity.ts            # Step 4: Validate (dev)
├── generator.ts                    # Full generator (existing)
├── quick-generator.ts              # Fast generator (existing)
└── reports/
    ├── shape-metrics-prod-YYYYMMDD.json     # Production metrics
    ├── calibrated-config-YYYYMMDD.json      # Calibrated params
    └── fidelity-report-YYYYMMDD.json        # Validation results
```

---

## ⚠️ Common Issues

### "ANONYMIZATION_SALT environment variable required"
**Fix**: Set production secret from secrets manager:
```bash
export ANONYMIZATION_SALT="$(aws secretsmanager get-secret-value ...)"
```

### Fidelity validation fails with large errors
**Fix**: Adjust power-law alpha in calibrated config:
- Error too high in p99 → **decrease alpha** (heavier tail)
- Error too high in p50 → **increase alpha** (lighter tail)

### Out of memory during generation
**Fix**: Increase Node.js heap size:
```bash
NODE_OPTIONS="--max-old-space-size=8192" npx ts-node generator.ts
```

---

## ✅ Success Checklist

- [ ] Production shape metrics extracted (no PII present)
- [ ] Generator calibrated to production distributions
- [ ] Pilot dataset generated (500K-5M messages)
- [ ] Fidelity validation passes (all tests or 3/4 with WARNING)
- [ ] Dataset exhibits production-like skew (hot rooms exist)
- [ ] Phase 2 index performance testing can proceed

---

## 🚀 Integration with Phase 2

Once fidelity validation **PASSES**:

1. **Capture pre-optimization baseline**:
   ```bash
   ts-node verify-index-performance.ts --pre-optimization
   ```

2. **Apply Phase 2 composite indexes**:
   ```bash
   psql "postgresql://..." -f docs/database/indexes/phase-2-indexes.sql
   ```

3. **Capture post-optimization baseline**:
   ```bash
   ts-node verify-index-performance.ts --post-optimization
   ```

4. **Compare and decide**:
   ```bash
   ts-node verify-index-performance.ts --compare pre.json post.json
   ```

**Expected results with production-like data**:
- Message history: 60-70% latency reduction
- Conversation list: 50-60% latency reduction
- Hot rooms: Index scan instead of seq scan

---

## 📞 Quick Help

**Command Reference**:
```bash
# Production shape extraction
ts-node production-shape-sampler.ts --help

# Generator calibration
ts-node calibrate-generator.ts --help

# Fidelity validation
ts-node validate-fidelity.ts --help
```

**Full Documentation**: See `docs/PRODUCTION_SHAPE_SAMPLING.md`

---

**Last Updated**: 2025-10-22  
**Status**: Ready for production shape extraction  
**Next Step**: Run production-shape-sampler.ts in production environment
