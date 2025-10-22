# Production Shape Sampling & Calibration Workflow

## Overview

This workflow enables **privacy-safe production sampling** combined with **calibrated synthetic data generation** to achieve high-fidelity test datasets that match real-world distributions without exposing PII.

## Architecture

```
┌─────────────────────┐
│  Production DB      │
│  (INSIDE BOUNDARY)  │
└──────────┬──────────┘
           │
           │ [1] Extract shape metrics only (NO PII)
           │     - Aggregate histograms
           │     - Percentiles
           │     - Type distributions
           │
           ▼
┌─────────────────────┐
│ Shape Metrics JSON  │ ◄─── ANONYMIZED, exportable
│ (aggregate only)    │
└──────────┬──────────┘
           │
           │ [2] Fit parametric models
           │     - Log-normal for content length
           │     - Power-law for message counts
           │     - Normalized distributions
           │
           ▼
┌─────────────────────┐
│ Calibrated Config   │
│ (generator params)  │
└──────────┬──────────┘
           │
           │ [3] Generate synthetic data
           │
           ▼
┌─────────────────────┐
│ Synthetic Dataset   │
│ (dev/test DB)       │
└──────────┬──────────┘
           │
           │ [4] Validate fidelity
           │     - Chi-square tests
           │     - KS tests
           │     - Error tolerance checks
           │
           ▼
┌─────────────────────┐
│ Fidelity Report     │ ◄─── GO/NO-GO decision
└─────────────────────┘
```

## Privacy Guarantees

### What is NEVER exported from production:

- ❌ User IDs, emails, usernames, phone numbers
- ❌ Message content (plaintext or encrypted)
- ❌ Conversation names or metadata
- ❌ Attachment URLs or filenames
- ❌ IP addresses, tokens, or session data
- ❌ Any field that could identify individuals

### What IS exported (aggregate only):

- ✅ Histogram buckets (e.g., "100-149 chars": 523 messages)
- ✅ Percentiles (e.g., p90 messages/convo = 450)
- ✅ Type distributions (e.g., TEXT: 85%, IMAGE: 10%)
- ✅ Temporal patterns (hourly/daily aggregates)
- ✅ Statistical parameters (mean, median, stddev)

**Privacy Level**: `ANONYMIZED_SHAPE_ONLY`

## Tools

### 1. `production-shape-sampler.ts`

**Purpose**: Extract aggregate distribution metrics from production database.

**Security Requirements**:

- Must run INSIDE production network boundary
- Requires `ANONYMIZATION_SALT` environment variable (min 32 chars, production secret)
- All identifiers tokenized with SHA-256 HMAC (irreversible)
- Only exports aggregate histograms and percentiles

**Usage**:

```bash
# In production environment
export ANONYMIZATION_SALT="$(aws secretsmanager get-secret-value \
  --secret-id prod/sampler/salt \
  --query SecretString \
  --output text)"

ts-node production-shape-sampler.ts \
  --output shape-metrics-prod-20251022.json \
  --window-days 30
```

**Output**: `shape-metrics-prod.json` containing:

- User metrics (username length distribution, profile completeness)
- Conversation metrics (type distribution, member counts, messages/convo percentiles)
- Message metrics (content length stats, type distribution, temporal patterns)

**Example Output**:

```json
{
  "extracted_at": "2025-10-22T14:30:00Z",
  "sample_window_days": 30,
  "privacy_level": "ANONYMIZED_SHAPE_ONLY",
  "conversations": {
    "messages_per_conversation_percentiles": {
      "p50": 45,
      "p75": 120,
      "p90": 450,
      "p95": 1200,
      "p99": 5000,
      "max": 15000
    },
    "type_distribution": {
      "DIRECT_MESSAGE": 12500,
      "GROUP_CHAT": 3500
    }
  },
  "messages": {
    "content_length_stats": {
      "mean": 85,
      "median": 42,
      "p95": 280
    }
  }
}
```

---

### 2. `calibrate-generator.ts`

**Purpose**: Fit parametric models to production shape metrics and generate calibrated generator configuration.

**Usage**:

```bash
ts-node calibrate-generator.ts \
  --shape shape-metrics-prod-20251022.json \
  --output calibrated-config.json
```

**What it does**:

1. **Fits distributions**:
   - Username length: Normal distribution (mean, stddev)
   - Messages/conversation: Power-law (alpha, min, max)
   - Content length: Log-normal (mean, median, p95)
   - Message types: Normalized probabilities

2. **Extracts temporal patterns**:
   - Hourly message weights (diurnal waves)
   - Day-of-week weights (weekend vs weekday)

3. **Generates calibrated config** with all parameters tuned to production shape

**Example Output**:

```json
{
  "calibration_metadata": {
    "source_shape_file": "2025-10-22T14:30:00Z",
    "calibrated_at": "2025-10-22T15:00:00Z",
    "production_sample_window_days": 30
  },
  "conversation_generation": {
    "type_distribution": {
      "DIRECT_MESSAGE": 0.7813,
      "GROUP_CHAT": 0.2187,
      "CHANNEL": 0.0
    },
    "messages_per_conversation": {
      "distribution": "power_law",
      "alpha": 1.85,
      "min": 1,
      "max": 15000,
      "p50": 45,
      "p90": 450,
      "p99": 5000
    }
  },
  "message_generation": {
    "content_length": {
      "distribution": "log_normal",
      "mean": 85,
      "median": 42,
      "p95": 280
    },
    "type_distribution": {
      "TEXT": 0.85,
      "IMAGE": 0.1,
      "FILE": 0.03,
      "AUDIO": 0.01,
      "VIDEO": 0.01
    }
  }
}
```

---

### 3. `validate-fidelity.ts`

**Purpose**: Compare synthetic dataset distributions to production shape metrics and generate GO/NO-GO decision.

**Usage**:

```bash
ts-node validate-fidelity.ts \
  --shape shape-metrics-prod-20251022.json \
  --tolerance 0.15 \
  --output fidelity-report.json
```

**Statistical Tests**:

1. **Conversation type distribution** (Chi-Square test)
   - H0: Synthetic matches production distribution
   - Threshold: p-value > 0.05

2. **Messages per conversation** (Kolmogorov-Smirnov test)
   - Compares percentile distributions (p50, p75, p90, p95, p99)
   - Threshold: Max error < tolerance (default 15%)

3. **Message type distribution** (Chi-Square test)
   - Validates TEXT/IMAGE/FILE/AUDIO/VIDEO ratios

4. **Content length** (Error percentage)
   - Mean and median error < tolerance

**Output**: `fidelity-report.json` containing:

- Test results (chi-square, KS statistic, error percentages)
- Overall verdict: `PASS` | `WARNING` | `FAIL`
- Recommendations for parameter adjustments

**Example Output**:

```json
{
  "validation_timestamp": "2025-10-22T16:00:00Z",
  "tolerance_threshold": 0.15,
  "overall_verdict": "PASS",
  "tests": {
    "conversation_types": {
      "chi_square_statistic": 2.45,
      "p_value": 0.29,
      "verdict": "PASS"
    },
    "messages_per_conversation": {
      "ks_statistic": 0.08,
      "max_percentile_error": 0.12,
      "verdict": "PASS"
    }
  },
  "summary": {
    "passed_tests": 4,
    "failed_tests": 0,
    "recommendations": [
      "Distributions match production shape within tolerance",
      "Dataset ready for Phase 2 performance testing"
    ]
  }
}
```

---

## Complete Workflow Example

### Step 1: Extract production shape (INSIDE PROD BOUNDARY)

```bash
# Run this in production environment with secure salt
export ANONYMIZATION_SALT="<PRODUCTION_SECRET_32_CHARS>"

cd /path/to/app/scripts/synthetic-data

ts-node production-shape-sampler.ts \
  --output shape-metrics-prod-20251022.json \
  --window-days 30

# COPY ONLY shape-metrics-prod-20251022.json to dev environment
# This file is safe to export (contains NO PII)
```

**Security Notes**:

- Run this during low-traffic window
- Limit window to 30-60 days (representative sample)
- Rotate `ANONYMIZATION_SALT` after each extraction
- Audit exported JSON to confirm no PII present

---

### Step 2: Calibrate generator (IN DEV ENVIRONMENT)

```bash
# Now in dev/test environment with shape metrics file

ts-node calibrate-generator.ts \
  --shape shape-metrics-prod-20251022.json \
  --output calibrated-config-20251022.json
```

**Output**:

```
=== GENERATOR CALIBRATION ===

[Calibrator] Loading shape metrics...
[Calibrator] ✓ Loaded metrics from 2025-10-22T14:30:00Z
[Calibrator]   Users: 50,000
[Calibrator]   Conversations: 16,000
[Calibrator]   Messages: 1,200,000

[Calibrator] Fitting parametric models...

[Calibrator] Fitting username length (normal distribution)...
[Calibrator]   Mean: 8.5, StdDev: 2.3

[Calibrator] Normalizing conversation type distribution...
[Calibrator]   DIRECT_MESSAGE: 78.1%
[Calibrator]   GROUP_CHAT: 21.9%

[Calibrator] Fitting messages per conversation (power law)...
[Calibrator]   Alpha: 1.85
[Calibrator]   Range: [1, 15000]
[Calibrator]   Production p50: 45
[Calibrator]   Production p99: 5000

[Calibrator] ✓ Calibration complete

[Output] ✓ Written to calibrated-config-20251022.json
```

---

### Step 3: Update generator with calibrated parameters

**Manual step**: Update `generator.ts` or `quick-generator.ts` to use calibrated parameters:

```typescript
// Before (hardcoded)
const conversationType = rng.next() < 0.7 ? "DIRECT_MESSAGE" : "GROUP_CHAT";

// After (calibrated)
const config = JSON.parse(
  fs.readFileSync("calibrated-config-20251022.json", "utf-8"),
);
const conversationType =
  rng.next() < config.conversation_generation.type_distribution.DIRECT_MESSAGE
    ? "DIRECT_MESSAGE"
    : "GROUP_CHAT";
```

Or use calibrated config as input to generator:

```bash
ts-node generator.ts \
  --band dev \
  --seed dev_calibrated_20251022 \
  --config calibrated-config-20251022.json
```

---

### Step 4: Generate pilot dataset

```bash
# Generate 5-10M messages for fidelity validation
NODE_OPTIONS="--max-old-space-size=4096" \
  ts-node quick-generator.ts \
  --target-messages 5000000 \
  --config calibrated-config-20251022.json
```

---

### Step 5: Validate fidelity

```bash
ts-node validate-fidelity.ts \
  --shape shape-metrics-prod-20251022.json \
  --tolerance 0.15 \
  --output fidelity-report-20251022.json
```

**Output**:

```
=== FIDELITY VALIDATION ===

[Test 1] Conversation type distribution...
[Test 1]   Chi-Square: 2.45, p-value: 0.290
[Test 1]   Verdict: PASS

[Test 2] Messages per conversation distribution...
[Test 2]   KS Statistic: 0.082
[Test 2]   Max Percentile Error: 12.0%
[Test 2]   Verdict: PASS

[Test 3] Message type distribution...
[Test 3]   Chi-Square: 3.12, p-value: 0.210
[Test 3]   Verdict: PASS

[Test 4] Content length distribution...
[Test 4]   Mean Error: 8.5%
[Test 4]   Median Error: 6.2%
[Test 4]   Verdict: PASS

=== VALIDATION SUMMARY ===
Overall Verdict: PASS
Passed: 4/4 tests
Failed: 0/4 tests

Recommendations:
  • Distributions match production shape within tolerance
  • Dataset ready for Phase 2 performance testing

[Output] ✓ Written to fidelity-report-20251022.json
```

---

### Step 6: GO Decision

**If fidelity validation PASSES**:

- ✅ Dataset exhibits production-like shape and skew
- ✅ Proceed with Phase 2 index performance testing
- ✅ Phase 2 measurements will be trustworthy

**If fidelity validation FAILS**:

1. Review recommendations in fidelity report
2. Adjust generator parameters (alpha, distributions)
3. Regenerate pilot dataset
4. Re-validate
5. Iterate until PASS

---

## Iteration Example

If messages per conversation p99 is too low:

```bash
# Check error
cat fidelity-report.json | jq '.tests.messages_per_conversation'
# Output: { "max_percentile_error": 0.25, "verdict": "FAIL" }

# Adjust power-law alpha (lower alpha = heavier tail)
# Edit calibrated-config.json:
{
  "messages_per_conversation": {
    "alpha": 1.65  // was 1.85, reduce for heavier tail
  }
}

# Regenerate
ts-node quick-generator.ts --config calibrated-config-20251022.json

# Re-validate
ts-node validate-fidelity.ts --shape shape-metrics-prod-20251022.json

# Check again
cat fidelity-report.json | jq '.tests.messages_per_conversation.verdict'
# Output: "PASS"
```

---

## Integration with Existing Tools

### Current State

You already have:

- ✅ `generator.ts` - Full-featured generator with power-law distributions
- ✅ `quick-generator.ts` - Optimized generator for fast dev datasets
- ✅ 500K messages generated and verified

### Next Steps

1. **Run production shape sampler** (in prod environment)
   - Extracts real distribution metrics
   - Output: `shape-metrics-prod.json` (safe to export)

2. **Calibrate generator** (in dev environment)
   - Fits parametric models to production shape
   - Output: `calibrated-config.json`

3. **Update generator** to use calibrated parameters
   - Modify `generator.ts` or `quick-generator.ts`
   - Or add `--config` CLI argument

4. **Validate fidelity** after generation
   - Compare synthetic vs production distributions
   - Output: GO/NO-GO decision

---

## Benefits

### High Privacy

- No PII ever leaves production boundary
- Only aggregate statistics exported
- Irreversible anonymization with HMAC-SHA256
- Compliant with GDPR, CCPA, SOC 2

### High Fidelity

- Matches production skew and burstiness
- Realistic hot-room patterns (power-law)
- Temporal patterns (diurnal, weekly)
- Validated with statistical tests

### Trustworthy Phase 2 Testing

- Index performance measured under realistic load
- Hot paths exhibit production-like behavior
- Latency improvements are representative
- Capacity planning based on real distributions

---

## File Locations

```
scripts/synthetic-data/
├── production-shape-sampler.ts  ← Run in prod (extracts metrics)
├── calibrate-generator.ts        ← Run in dev (fits models)
├── validate-fidelity.ts          ← Run in dev (validates)
├── generator.ts                  ← Existing full generator
├── quick-generator.ts            ← Existing optimized generator
└── reports/
    ├── shape-metrics-prod-20251022.json       ← Production metrics (safe to export)
    ├── calibrated-config-20251022.json        ← Generator config (calibrated)
    └── fidelity-report-20251022.json          ← Validation results
```

---

## Troubleshooting

### Error: "ANONYMIZATION_SALT environment variable required"

**Problem**: Production sampler requires secure salt.

**Solution**:

```bash
# Retrieve from secrets manager
export ANONYMIZATION_SALT="$(aws secretsmanager get-secret-value \
  --secret-id prod/sampler/salt \
  --query SecretString \
  --output text)"
```

### Error: "No such file or directory: shape-metrics-prod.json"

**Problem**: Calibrator or validator can't find production metrics.

**Solution**:

```bash
# Ensure shape metrics file exists
ls -la shape-metrics-prod-*.json

# Use correct path
ts-node calibrate-generator.ts --shape shape-metrics-prod-20251022.json
```

### Fidelity validation FAILS with large errors

**Problem**: Generator parameters don't match production shape.

**Solution**:

1. Check which test failed (conversation types, messages/convo, etc.)
2. Review recommendations in fidelity report
3. Adjust parameters in calibrated config:
   - Increase alpha → shorter tail (fewer huge rooms)
   - Decrease alpha → heavier tail (more huge rooms)
   - Adjust type distributions directly
4. Regenerate and re-validate

---

## Security Checklist

Before exporting shape metrics from production:

- [ ] `ANONYMIZATION_SALT` is a production secret (min 32 chars)
- [ ] Salt is rotated after each extraction
- [ ] Output file contains NO user IDs, emails, or message content
- [ ] Only aggregate histograms and percentiles are present
- [ ] File has been audited by security team
- [ ] Export is logged in audit trail
- [ ] File is encrypted in transit and at rest

---

## Performance Notes

### Production Sampler

- **Time**: 5-10 minutes for 30-day window (millions of messages)
- **Load**: Read-only queries, minimal production impact
- **Best time**: During low-traffic hours (2-6 AM)

### Calibrator

- **Time**: <1 second (just JSON parsing and math)
- **Load**: No database access

### Fidelity Validator

- **Time**: 5-10 minutes for 5-10M synthetic messages
- **Load**: Runs on dev/test database (no production impact)

---

## Success Metrics

✅ **Privacy preserved**: No PII exported from production  
✅ **Fidelity achieved**: All tests pass with <15% error  
✅ **Phase 2 ready**: Dataset exhibits production-like skew  
✅ **Trustworthy measurements**: Index performance validated under realistic load

---

## Questions & Support

**Q: Can I run this without access to production?**  
A: No. Production shape sampler must run inside production network boundary. If you don't have production access, use the existing `quick-generator.ts` with estimated parameters.

**Q: How often should I re-extract production metrics?**  
A: Quarterly or when traffic patterns change significantly (e.g., post-viral-growth, new features).

**Q: What if fidelity validation never passes?**  
A: Start with higher tolerance (0.25 = ±25%) and gradually tighten. Focus on the most important tests (messages per conversation, message types).

**Q: Can I use this for other datasets (users, posts, etc.)?**  
A: Yes! Adapt the sampler and validator to extract metrics for any entity. The workflow is generic.

---

**Status**: Ready for production shape extraction  
**Last Updated**: 2025-10-22  
**Next Step**: Run `production-shape-sampler.ts` in production environment
