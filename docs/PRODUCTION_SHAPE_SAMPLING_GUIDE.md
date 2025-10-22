# Production Shape Sampling & Synthetic Calibration Guide

**Version**: 1.0.0  
**Date**: 22 October 2025  
**Roles**: Data Privacy Engineer + Performance Data Scientist

---

## 🎯 Mission Overview

Extract minimal, irreversible, shape-only samples from production to calibrate synthetic data generation with **zero PII exposure** while achieving **production-like statistical fidelity**.

### Two-Phase Approach

1. **Phase A: Privacy-Safe Shape Extraction** (Privacy Engineer)
   - Run INSIDE production network boundary
   - Extract aggregate distributions only
   - Never export raw IDs, tokens, or plaintext
   - Irreversible anonymization (SHA-256 + salt)

2. **Phase B: Synthetic Calibration** (Data Scientist)
   - Fit parametric models to shape metrics
   - Configure synthetic generator parameters
   - Validate distributional fidelity (KS-test, chi-squared)
   - Iterate until error tolerances met

---

## 📊 Phase A: Production Shape Extraction

### Security Architecture

```
┌─────────────────────────────────────────────────────────┐
│              PRODUCTION TRUST BOUNDARY                   │
│                                                          │
│  ┌──────────────┐        ┌─────────────────┐           │
│  │ Production   │───────>│ Shape Sampler   │           │
│  │ Database     │        │ (in-boundary)   │           │
│  │              │        │                 │           │
│  │ • Users      │        │ EXTRACTS:       │           │
│  │ • Messages   │        │ ✓ Histograms    │           │
│  │ • Convos     │        │ ✓ Percentiles   │           │
│  └──────────────┘        │ ✓ Distributions │           │
│                          │                 │           │
│                          │ NEVER EXPORTS:  │           │
│                          │ ✗ Raw user IDs  │           │
│                          │ ✗ Plaintext     │           │
│                          │ ✗ Reversible    │           │
│                          │   tokens        │           │
│                          └────────┬────────┘           │
│                                   │                     │
└───────────────────────────────────┼─────────────────────┘
                                    │
                                    v
                          ┌─────────────────┐
                          │ shape-metrics   │
                          │ .json           │
                          │                 │
                          │ SAFE TO EXPORT  │
                          │ (aggregate only)│
                          └─────────────────┘
```

### Prerequisites

**Environment**:

- Access to production database (read-only replica preferred)
- Production network access (VPN or bastion host)
- Secrets manager access for `ANONYMIZATION_SALT`

**Tools**:

```bash
# Ensure you're on production network
echo $PROD_NETWORK_CONNECTED  # Should be "true"

# Set anonymization salt (from secrets manager)
export ANONYMIZATION_SALT="$(aws secretsmanager get-secret-value \
  --secret-id prod/shape-sampler/salt \
  --query SecretString --output text)"

# Verify salt is set (DO NOT echo the actual value)
[ -n "$ANONYMIZATION_SALT" ] && echo "✓ Salt configured" || echo "✗ Salt missing"
```

### Step 1: Extract Shape Metrics

```bash
cd /Users/harishraghave/Desktop/colleging/college-id-signup-1/scripts/synthetic-data

# Run shape sampler (read-only, aggregate-only)
ts-node production-sampler.ts \
  --output shape-metrics-prod-20251022.json \
  --window-days 30

# Expected output:
# [ShapeSampler] Initialized with production salt
# [Users] Sampling user metrics...
# [Users] ✓ Sampled 142,350 users
# [Conversations] Sampling conversation metrics...
# [Conversations] ✓ Sampled 287,420 conversations
# [Messages] Sampling message metrics...
# [Messages] ✓ Sampled 95,324,871 messages (30-day window)
# [ReadReceipts] Sampling read timing...
# [ReadReceipts] ✓ Sampled 78,166,394 read receipts
# [Attachments] Sampling attachment distribution...
# [Attachments] ✓ Sampled 14,298,731 attachments
#
# [Output] ✓ Written to shape-metrics-prod-20251022.json
# [Manifest] ✓ Written to mapping-manifest-prod-20251022.json
```

**Duration**: 5-15 minutes (depends on database size)

### Step 2: Validate No PII Exported

```bash
# Automated PII scan
ts-node validate-no-pii.ts --input shape-metrics-prod-20251022.json

# Manual inspection checklist
jq 'keys' shape-metrics-prod-20251022.json
# Expected: ["extracted_at", "sample_window_days", "privacy_level", "users", "conversations", "messages", "read_receipts", "attachments"]

# Verify privacy level
jq '.privacy_level' shape-metrics-prod-20251022.json
# Expected: "ANONYMIZED_SHAPE_ONLY"

# Check no raw IDs present
jq -r '.. | select(type == "string")' shape-metrics-prod-20251022.json | grep -E '^[0-9a-f]{8}-' && echo "⚠️ Found UUID-like strings" || echo "✓ No raw IDs detected"

# Check no email addresses
jq -r '.. | select(type == "string")' shape-metrics-prod-20251022.json | grep -E '@' && echo "⚠️ Found @ symbols" || echo "✓ No emails detected"
```

### Step 3: Review Exported Shape Metrics

```bash
# Summary statistics
jq '{
  extracted_at,
  sample_window_days,
  privacy_level,
  total_users: .users.total_count,
  total_conversations: .conversations.total_count,
  total_messages: .messages.total_count,
  media_ratio: .messages.media_ratio,
  read_rate: .read_receipts.read_rate
}' shape-metrics-prod-20251022.json
```

**Example Output**:

```json
{
  "extracted_at": "2025-10-22T14:30:22Z",
  "sample_window_days": 30,
  "privacy_level": "ANONYMIZED_SHAPE_ONLY",
  "total_users": 142350,
  "total_conversations": 287420,
  "total_messages": 95324871,
  "media_ratio": 0.163,
  "read_rate": 0.82
}
```

### What Gets Exported (SAFE)

✅ **Aggregate Histograms**:

- Username length distribution: `{5: 120, 10: 3420, 15: 8901, ...}`
- Conversation size distribution: `{2: 201234, 5: 45231, 10: 12034, ...}`
- Message content length buckets: `{50: 12000, 100: 23000, 500: 5000, ...}`
- Inter-arrival time histogram: `{10s: 45000, 60s: 23000, 300s: 8000, ...}`

✅ **Statistical Percentiles**:

- Messages per conversation: `{p50: 14, p75: 87, p90: 423, p95: 1205, p99: 8934}`
- Read receipt delay: `{p50: 35s, p75: 245s, p90: 3420s, p95: 21600s}`

✅ **Type Distributions**:

- Conversation types: `{one_to_one: 0.68, small_group: 0.27, large_group: 0.05}`
- Attachment types: `{image: 0.67, video: 0.14, document: 0.13, audio: 0.06}`

✅ **Temporal Patterns**:

- Hourly message distribution: `[1234, 890, 567, ..., 8901, 12345, ...]` (24 buckets)
- Weekday/weekend ratio: `1.38`
- Burst coefficient: `2.47`

### What NEVER Gets Exported (PROTECTED)

❌ Raw user IDs or usernames  
❌ Raw conversation IDs or names  
❌ Message content (plaintext or encrypted)  
❌ Email addresses or phone numbers  
❌ Authentication tokens or API keys  
❌ IP addresses or session identifiers  
❌ Reversible pseudonyms or hashes without salt

---

## 🔬 Phase B: Synthetic Calibration

### Step 1: Fit Parametric Distributions

Create a calibration script to estimate distribution parameters from shape metrics:

```typescript
// scripts/synthetic-data/calibrate-from-production.ts
import * as fs from "fs";

interface ShapeMetrics {
  // ... (see production-sampler.ts)
}

interface CalibrationReport {
  source: string;
  calibrated_at: string;
  fitted_distributions: {
    conversation_sizes: {
      type_mix: {
        one_to_one: number;
        small_group: number;
        large_group: number;
      };
      small_group_geometric_p: number;
      large_group_powerlaw_alpha: number;
    };
    messages_per_conversation: {
      distribution: "power_law";
      alpha: number;
      observed_p50: number;
      observed_p95: number;
      observed_p99: number;
    };
    content_length: {
      distribution: "log_normal";
      mu: number;
      sigma: number;
      observed_mean: number;
      observed_median: number;
    };
    inter_arrival: {
      distribution: "exponential_with_diurnal";
      mean_lambda_peak: number;
      mean_lambda_trough: number;
      burst_coefficient: number;
    };
    read_timing: {
      immediate_percentage: number;
      near_term_exponential_mean: number;
      delayed_lognormal_mu: number;
      delayed_lognormal_sigma: number;
    };
  };
  fidelity_targets: {
    conversation_type_tolerance: number;
    media_ratio_tolerance: number;
    percentile_tolerance: number;
  };
}

function fitConversationSizes(
  metrics: ShapeMetrics,
): CalibrationReport["fitted_distributions"]["conversation_sizes"] {
  // Extract conversation size histogram
  const histogram = metrics.conversations.member_count_histogram;

  // Calculate type mix
  const total = Object.values(histogram).reduce((sum, count) => sum + count, 0);
  const oneToOne = (histogram["2"] || 0) / total;
  const smallGroup =
    Object.entries(histogram)
      .filter(([size]) => parseInt(size) >= 3 && parseInt(size) <= 20)
      .reduce((sum, [, count]) => sum + count, 0) / total;
  const largeGroup = 1 - oneToOne - smallGroup;

  // Fit geometric distribution for small groups
  // p = 1 / (mean_size - 2)
  const smallGroupSizes = Object.entries(histogram)
    .filter(([size]) => parseInt(size) >= 3 && parseInt(size) <= 20)
    .map(([size, count]) => ({ size: parseInt(size), count }));
  const meanSmallGroup =
    smallGroupSizes.reduce((sum, { size, count }) => sum + size * count, 0) /
    smallGroupSizes.reduce((sum, { count }) => sum + count, 0);
  const geometricP = 1 / (meanSmallGroup - 2);

  // Fit power-law for large groups (MLE estimation)
  const largeGroupSizes = Object.entries(histogram)
    .filter(([size]) => parseInt(size) >= 21)
    .map(([size, count]) => ({ size: parseInt(size), count }));
  const n = largeGroupSizes.reduce((sum, { count }) => sum + count, 0);
  const sumLogX = largeGroupSizes.reduce(
    (sum, { size, count }) => sum + Math.log(size) * count,
    0,
  );
  const alpha = 1 + n / (sumLogX - n * Math.log(20)); // MLE for power-law

  return {
    type_mix: {
      one_to_one: oneToOne,
      small_group: smallGroup,
      large_group: largeGroup,
    },
    small_group_geometric_p: geometricP,
    large_group_powerlaw_alpha: alpha,
  };
}

function fitMessagesPerConversation(
  metrics: ShapeMetrics,
): CalibrationReport["fitted_distributions"]["messages_per_conversation"] {
  // Use activity percentiles to fit power-law
  const { p50, p75, p90, p95, p99 } =
    metrics.conversations.activity_percentiles;

  // Power-law: p99 / p50 ≈ (99/50)^(1/(1-α))
  // Solve for α: α = 1 - log(p99/p50) / log(99/50)
  const ratio = p99 / p50;
  const alpha = 1 - Math.log(ratio) / Math.log(99 / 50);

  return {
    distribution: "power_law",
    alpha: Math.max(1.5, Math.min(2.5, alpha)), // Clamp to reasonable range
    observed_p50: p50,
    observed_p95: p95,
    observed_p99: p99,
  };
}

function fitContentLength(
  metrics: ShapeMetrics,
): CalibrationReport["fitted_distributions"]["content_length"] {
  // Extract content length histogram and fit log-normal
  const histogram = metrics.messages.content_length_histogram;

  // Calculate mean and median from histogram
  let sum = 0;
  let count = 0;
  const values: number[] = [];

  for (const [bucket, freq] of Object.entries(histogram)) {
    const size = parseInt(bucket);
    sum += size * freq;
    count += freq;
    for (let i = 0; i < freq; i++) values.push(size);
  }

  const mean = sum / count;
  values.sort((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)];

  // Log-normal parameters from mean and median
  // mean = exp(μ + σ²/2)
  // median = exp(μ)
  const mu = Math.log(median);
  const sigma = Math.sqrt(2 * (Math.log(mean) - mu));

  return {
    distribution: "log_normal",
    mu,
    sigma,
    observed_mean: mean,
    observed_median: median,
  };
}

function fitInterArrival(
  metrics: ShapeMetrics,
): CalibrationReport["fitted_distributions"]["inter_arrival"] {
  // Extract hourly distribution and burst coefficient
  const hourlyDist = metrics.messages.hourly_distribution;
  const burstCoeff = metrics.messages.burst_coefficient;

  // Find peak and trough hours
  const maxHourly = Math.max(...hourlyDist);
  const minHourly = Math.min(...hourlyDist);

  // Exponential lambda = 1 / mean_inter_arrival
  // Estimate from message rate: lambda = message_rate
  const totalMessages = hourlyDist.reduce((sum, count) => sum + count, 0);
  const avgMessagesPerHour = totalMessages / 24;
  const avgLambda = avgMessagesPerHour / 3600; // messages per second

  // Peak/trough modulation
  const peakLambda = avgLambda * (maxHourly / avgMessagesPerHour);
  const troughLambda = avgLambda * (minHourly / avgMessagesPerHour);

  return {
    distribution: "exponential_with_diurnal",
    mean_lambda_peak: peakLambda,
    mean_lambda_trough: troughLambda,
    burst_coefficient: burstCoeff,
  };
}

function fitReadTiming(
  metrics: ShapeMetrics,
): CalibrationReport["fitted_distributions"]["read_timing"] {
  const { immediate_percentage, near_term_percentage, delayed_percentage } =
    metrics.read_receipts;
  const delayHistogram = metrics.read_receipts.delay_histogram_minutes;

  // Fit exponential for near-term (minutes scale)
  const nearTermDelays = Object.entries(delayHistogram)
    .filter(([minutes]) => parseInt(minutes) >= 1 && parseInt(minutes) <= 60)
    .map(([minutes, count]) => ({ delay: parseInt(minutes), count }));
  const meanNearTerm =
    nearTermDelays.reduce((sum, { delay, count }) => sum + delay * count, 0) /
    nearTermDelays.reduce((sum, { count }) => sum + count, 0);

  // Fit log-normal for delayed (hours to days)
  const delayedDelays = Object.entries(delayHistogram)
    .filter(([minutes]) => parseInt(minutes) > 60)
    .map(([minutes, count]) => ({ delay: parseInt(minutes), count }));
  const logDelays = delayedDelays.map(({ delay, count }) => ({
    logDelay: Math.log(delay),
    count,
  }));
  const muDelayed =
    logDelays.reduce((sum, { logDelay, count }) => sum + logDelay * count, 0) /
    logDelays.reduce((sum, { count }) => sum + count, 0);
  const varianceDelayed =
    logDelays.reduce(
      (sum, { logDelay, count }) =>
        sum + Math.pow(logDelay - muDelayed, 2) * count,
      0,
    ) / logDelays.reduce((sum, { count }) => sum + count, 0);
  const sigmaDelayed = Math.sqrt(varianceDelayed);

  return {
    immediate_percentage,
    near_term_exponential_mean: meanNearTerm,
    delayed_lognormal_mu: muDelayed,
    delayed_lognormal_sigma: sigmaDelayed,
  };
}

async function calibrate(shapePath: string, outputPath: string) {
  console.log("[Calibration] Loading shape metrics...");
  const metrics: ShapeMetrics = JSON.parse(fs.readFileSync(shapePath, "utf-8"));

  console.log("[Calibration] Fitting distributions...");
  const report: CalibrationReport = {
    source: shapePath,
    calibrated_at: new Date().toISOString(),
    fitted_distributions: {
      conversation_sizes: fitConversationSizes(metrics),
      messages_per_conversation: fitMessagesPerConversation(metrics),
      content_length: fitContentLength(metrics),
      inter_arrival: fitInterArrival(metrics),
      read_timing: fitReadTiming(metrics),
    },
    fidelity_targets: {
      conversation_type_tolerance: 0.1, // ±10% for type mix
      media_ratio_tolerance: 0.05, // ±5% for media ratio
      percentile_tolerance: 0.2, // ±20% for percentiles
    },
  };

  console.log("[Calibration] ✓ Fitted all distributions");
  console.log("[Calibration] Writing calibration report...");
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`[Calibration] ✓ Written to ${outputPath}`);

  // Print summary
  console.log("\n=== CALIBRATION SUMMARY ===");
  console.log(
    `Conversation type mix: ${(report.fitted_distributions.conversation_sizes.type_mix.one_to_one * 100).toFixed(1)}% 1:1, ${(report.fitted_distributions.conversation_sizes.type_mix.small_group * 100).toFixed(1)}% small, ${(report.fitted_distributions.conversation_sizes.type_mix.large_group * 100).toFixed(1)}% large`,
  );
  console.log(
    `Messages/conversation power-law: α=${report.fitted_distributions.messages_per_conversation.alpha.toFixed(2)} (p50=${report.fitted_distributions.messages_per_conversation.observed_p50}, p95=${report.fitted_distributions.messages_per_conversation.observed_p95})`,
  );
  console.log(
    `Content length log-normal: μ=${report.fitted_distributions.content_length.mu.toFixed(2)}, σ=${report.fitted_distributions.content_length.sigma.toFixed(2)} (mean=${report.fitted_distributions.content_length.observed_mean.toFixed(0)}, median=${report.fitted_distributions.content_length.observed_median.toFixed(0)})`,
  );
  console.log(
    `Inter-arrival exponential: λ_peak=${report.fitted_distributions.inter_arrival.mean_lambda_peak.toFixed(4)}, λ_trough=${report.fitted_distributions.inter_arrival.mean_lambda_trough.toFixed(4)}`,
  );
}

// CLI
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error(
    "Usage: ts-node calibrate-from-production.ts <shape-metrics.json> <output-calibration.json>",
  );
  process.exit(1);
}

calibrate(args[0], args[1]).catch(console.error);
```

**Usage**:

```bash
ts-node calibrate-from-production.ts \
  shape-metrics-prod-20251022.json \
  calibration-report-20251022.json
```

### Step 2: Update Generator Configuration

Apply fitted parameters to `distribution-spec.json`:

```bash
# Backup current spec
cp distribution-spec.json distribution-spec-original.json

# Update with calibrated values
jq --argfile cal calibration-report-20251022.json '
  .conversations.type_distribution = $cal.fitted_distributions.conversation_sizes.type_mix |
  .messages.per_conversation_distribution.alpha = $cal.fitted_distributions.messages_per_conversation.alpha |
  .messages.content.text_length.mu = $cal.fitted_distributions.content_length.mu |
  .messages.content.text_length.sigma = $cal.fitted_distributions.content_length.sigma |
  .messages.inter_arrival.mean_lambda_peak = $cal.fitted_distributions.inter_arrival.mean_lambda_peak |
  .messages.inter_arrival.mean_lambda_trough = $cal.fitted_distributions.inter_arrival.mean_lambda_trough
' distribution-spec.json > distribution-spec-calibrated.json

# Review changes
diff distribution-spec.json distribution-spec-calibrated.json
```

### Step 3: Generate Pilot Dataset

Create a small pilot dataset (5-10M messages) with calibrated parameters:

```bash
# Generate pilot dataset
ts-node generator.ts \
  --band dev \
  --seed pilot_calibrated_20251022 \
  --config distribution-spec-calibrated.json

# Expected: 5M messages in ~30 minutes
```

### Step 4: Validate Distributional Fidelity

Compare pilot dataset against production shape metrics:

```bash
# Run fidelity validator with calibration report
ts-node validate-dataset-fidelity.ts \
  --config report_dev_*.json \
  --baseline calibration-report-20251022.json \
  --tolerance 0.20

# Expected output:
# [Validation] Comparing against production baseline...
# [Distribution] Conversation type mix:
#   1:1: 69.8% (baseline: 68.2%, Δ=+1.6%, ✓ within ±10%)
#   Small: 26.1% (baseline: 27.3%, Δ=-1.2%, ✓ within ±10%)
#   Large: 4.1% (baseline: 4.5%, Δ=-0.4%, ✓ within ±10%)
# [Distribution] Messages per conversation:
#   p50: 13 (baseline: 14, Δ=-7%, ✓ within ±20%)
#   p95: 487 (baseline: 523, Δ=-7%, ✓ within ±20%)
#   p99: 4832 (baseline: 5201, Δ=-7%, ✓ within ±20%)
# [Distribution] Content length:
#   Mean: 148 (baseline: 152, Δ=-3%, ✓ within ±20%)
#   Median: 88 (baseline: 91, Δ=-3%, ✓ within ±20%)
# ...
# === VALIDATION SUMMARY ===
# Total checks: 15
# Passed: 14
# Warnings: 1 (media ratio: 13.2% vs 16.3%, Δ=19%)
# Decision: GO (within tolerance)
```

### Step 5: Statistical Tests

Run KS-test and chi-squared for rigorous validation:

```typescript
// scripts/synthetic-data/statistical-tests.ts
import * as fs from "fs";

function kolmogorovSmirnovTest(
  sample1: number[],
  sample2: number[],
): { statistic: number; pValue: number } {
  // Sort samples
  sample1.sort((a, b) => a - b);
  sample2.sort((a, b) => a - b);

  // Compute empirical CDFs
  const allValues = [...new Set([...sample1, ...sample2])].sort(
    (a, b) => a - b,
  );
  let maxDiff = 0;

  for (const value of allValues) {
    const cdf1 = sample1.filter((x) => x <= value).length / sample1.length;
    const cdf2 = sample2.filter((x) => x <= value).length / sample2.length;
    maxDiff = Math.max(maxDiff, Math.abs(cdf1 - cdf2));
  }

  // Compute p-value (approximate)
  const n = Math.sqrt(
    (sample1.length * sample2.length) / (sample1.length + sample2.length),
  );
  const pValue = Math.exp(-2 * maxDiff * maxDiff * n * n);

  return { statistic: maxDiff, pValue };
}

function chiSquaredTest(
  observed: Record<string, number>,
  expected: Record<string, number>,
): { statistic: number; pValue: number; df: number } {
  const buckets = Object.keys(observed);
  let chiSq = 0;

  for (const bucket of buckets) {
    const obs = observed[bucket] || 0;
    const exp = expected[bucket] || 0;
    if (exp > 0) {
      chiSq += Math.pow(obs - exp, 2) / exp;
    }
  }

  const df = buckets.length - 1;
  // Approximate p-value using chi-squared CDF (simplified)
  const pValue = Math.exp(-chiSq / 2);

  return { statistic: chiSq, pValue, df };
}

// Run tests on pilot dataset vs production baseline
async function runTests(pilotReport: string, productionShape: string) {
  console.log("[StatTests] Loading pilot dataset report...");
  const pilot = JSON.parse(fs.readFileSync(pilotReport, "utf-8"));

  console.log("[StatTests] Loading production shape metrics...");
  const prod = JSON.parse(fs.readFileSync(productionShape, "utf-8"));

  console.log("[StatTests] Running KS-test on conversation sizes...");
  // Extract conversation size samples
  const pilotConvoSizes = Object.entries(
    pilot.distributions.conversation_size_histogram,
  ).flatMap(([size, count]) => Array(count as number).fill(parseInt(size)));
  const prodConvoSizes = Object.entries(
    prod.conversations.member_count_histogram,
  ).flatMap(([size, count]) => Array(count as number).fill(parseInt(size)));
  const ksConvo = kolmogorovSmirnovTest(pilotConvoSizes, prodConvoSizes);
  console.log(
    `  KS statistic: ${ksConvo.statistic.toFixed(4)}, p-value: ${ksConvo.pValue.toFixed(4)}`,
  );
  console.log(
    `  ${ksConvo.pValue > 0.05 ? "✓" : "✗"} ${ksConvo.pValue > 0.05 ? "Cannot reject null hypothesis (distributions match)" : "Reject null hypothesis (distributions differ)"}`,
  );

  console.log("[StatTests] Running chi-squared on content length...");
  const chiLength = chiSquaredTest(
    pilot.distributions.content_length_histogram,
    prod.messages.content_length_histogram,
  );
  console.log(
    `  χ² statistic: ${chiLength.statistic.toFixed(2)}, df: ${chiLength.df}, p-value: ${chiLength.pValue.toFixed(4)}`,
  );
  console.log(
    `  ${chiLength.pValue > 0.05 ? "✓" : "✗"} ${chiLength.pValue > 0.05 ? "Good fit" : "Poor fit"}`,
  );

  // More tests...
  console.log("\n=== STATISTICAL TEST SUMMARY ===");
  console.log(
    "Conversation sizes (KS): " + (ksConvo.pValue > 0.05 ? "PASS" : "FAIL"),
  );
  console.log(
    "Content length (χ²): " + (chiLength.pValue > 0.05 ? "PASS" : "FAIL"),
  );
}

// CLI
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error(
    "Usage: ts-node statistical-tests.ts <pilot-report.json> <production-shape.json>",
  );
  process.exit(1);
}

runTests(args[0], args[1]).catch(console.error);
```

**Usage**:

```bash
ts-node statistical-tests.ts \
  report_dev_*.json \
  shape-metrics-prod-20251022.json

# Expected: All tests PASS with p-value > 0.05
```

### Step 6: Iterate Until Convergence

If validation fails, adjust parameters and regenerate:

```bash
# Example: Increase heavy room percentage to match production
jq '.conversations.heavy_rooms.percentage = 0.025' \
  distribution-spec-calibrated.json > distribution-spec-calibrated-v2.json

# Regenerate pilot
ts-node generator.ts \
  --band dev \
  --seed pilot_calibrated_v2_20251022 \
  --config distribution-spec-calibrated-v2.json

# Re-validate
ts-node validate-dataset-fidelity.ts \
  --config report_dev_*.json \
  --baseline calibration-report-20251022.json \
  --tolerance 0.20
```

**Convergence Criteria**:

- ≤2 warnings across all 15 distribution checks
- All critical metrics within tolerance (±10% for type mix, ±5% for media ratio)
- KS-test p-value > 0.05 for conversation sizes and message volume
- Chi-squared p-value > 0.05 for content length histogram

---

## 📈 Success Metrics

### Phase A: Privacy-Safe Extraction

✅ **Zero PII Exposure**:

- No raw user IDs, emails, or plaintext content exported
- All identifiers irreversibly anonymized (SHA-256 + salt)
- Automated PII scan passes with 0 findings

✅ **Shape Signal Captured**:

- 15+ distribution metrics extracted
- Statistical percentiles (p50, p75, p90, p95, p99)
- Temporal patterns (hourly, diurnal, burst coefficient)

### Phase B: Synthetic Calibration

✅ **Distributional Fidelity**:

- Conversation type mix within ±10%
- Media ratio within ±5%
- Messages per conversation percentiles within ±20%
- Content length mean/median within ±20%

✅ **Statistical Validation**:

- KS-test p-value > 0.05 (fail to reject H0: distributions match)
- Chi-squared p-value > 0.05 (good fit)
- ≤2 warnings across all checks

✅ **Hot Path Realism**:

- Heavy rooms (2% of conversations) exhibit 30% of traffic
- Diurnal patterns match peak/trough ratio (2.5×)
- Burst coefficient preserved (2.5×)

---

## 🔐 Security Checklist

### Before Running Production Sampler

- [ ] Confirmed on production network (VPN/bastion)
- [ ] `ANONYMIZATION_SALT` set from secrets manager
- [ ] Read-only database replica configured (optional but recommended)
- [ ] Network egress logging enabled
- [ ] DBA approval obtained for read queries

### After Shape Extraction

- [ ] Automated PII scan passed (0 findings)
- [ ] Manual inspection: no UUIDs, emails, phone numbers
- [ ] Privacy level confirmed: `ANONYMIZED_SHAPE_ONLY`
- [ ] Output file stored in secure location
- [ ] Shape metrics reviewed by security team

### Data Handling

- [ ] Shape metrics file encrypted at rest (if stored)
- [ ] Access restricted to data engineering team
- [ ] Retention policy: 90 days max
- [ ] Deletion after synthetic calibration complete

---

## 🎬 Complete Workflow Example

```bash
# === PHASE A: PRODUCTION SHAPE EXTRACTION (5-15 min) ===

# 1. Connect to production network
ssh bastion.prod.example.com

# 2. Set anonymization salt
export ANONYMIZATION_SALT="$(aws secretsmanager get-secret-value --secret-id prod/shape-sampler/salt --query SecretString --output text)"

# 3. Extract shape metrics
cd /app/college-id-signup-1/scripts/synthetic-data
ts-node production-sampler.ts --output shape-metrics-prod-20251022.json --window-days 30

# 4. Validate no PII
ts-node validate-no-pii.ts --input shape-metrics-prod-20251022.json
# Expected: ✓ No PII detected

# 5. Securely copy shape metrics to dev environment
scp shape-metrics-prod-20251022.json dev.example.com:~/shape-metrics/


# === PHASE B: SYNTHETIC CALIBRATION (1-2 hours) ===

# Switch to dev environment
ssh dev.example.com
cd ~/college-id-signup-1/scripts/synthetic-data

# 6. Fit parametric distributions
ts-node calibrate-from-production.ts \
  ~/shape-metrics/shape-metrics-prod-20251022.json \
  calibration-report-20251022.json

# 7. Update generator config
jq --argfile cal calibration-report-20251022.json '
  .conversations.type_distribution = $cal.fitted_distributions.conversation_sizes.type_mix |
  .messages.per_conversation_distribution.alpha = $cal.fitted_distributions.messages_per_conversation.alpha
' distribution-spec.json > distribution-spec-calibrated.json

# 8. Generate pilot dataset (5M messages, ~30 min)
ts-node generator.ts --band dev --seed pilot_calibrated_20251022 --config distribution-spec-calibrated.json

# 9. Validate fidelity
ts-node validate-dataset-fidelity.ts \
  --config report_dev_*.json \
  --baseline calibration-report-20251022.json \
  --tolerance 0.20
# Expected: GO (within tolerance)

# 10. Run statistical tests
ts-node statistical-tests.ts \
  report_dev_*.json \
  ~/shape-metrics/shape-metrics-prod-20251022.json
# Expected: All tests PASS

# 11. If PASS, generate staging dataset (100M messages, ~8 hours)
ts-node generator.ts --band staging --seed staging_calibrated_20251022 --config distribution-spec-calibrated.json

# === TOTAL DURATION: ~9 hours (extraction + calibration + pilot + staging) ===
```

---

## 🚨 Troubleshooting

### Production Sampler Issues

**Problem**: `ANONYMIZATION_SALT environment variable required`

**Solution**:

```bash
# Retrieve from secrets manager
export ANONYMIZATION_SALT="$(aws secretsmanager get-secret-value \
  --secret-id prod/shape-sampler/salt \
  --query SecretString --output text)"

# Verify (without revealing value)
[ -n "$ANONYMIZATION_SALT" ] && echo "✓ Salt set" || echo "✗ Salt missing"
```

**Problem**: PII scan detects email-like strings

**Solution**: Review false positives

```bash
# Find offending strings
jq -r '.. | select(type == "string")' shape-metrics.json | grep '@'

# If legitimate (e.g., "@media" in CSS), whitelist in validator
# If actual PII, DO NOT EXPORT - regenerate with stricter filters
```

### Calibration Issues

**Problem**: Fitted alpha parameter unrealistic (α < 1.0 or α > 3.0)

**Solution**: Clamp to reasonable range

```typescript
const alpha = Math.max(1.5, Math.min(2.5, fittedAlpha)); // Force into [1.5, 2.5]
```

**Problem**: KS-test fails (p-value < 0.05)

**Solution**: Inspect distributions visually

```bash
# Plot histograms side-by-side
python3 << EOF
import json
import matplotlib.pyplot as plt

pilot = json.load(open('report_dev_*.json'))
prod = json.load(open('shape-metrics-prod-20251022.json'))

# Plot conversation size distribution
fig, ax = plt.subplots()
ax.bar(pilot['distributions']['conversation_size_histogram'].keys(),
       pilot['distributions']['conversation_size_histogram'].values(),
       alpha=0.5, label='Pilot')
ax.bar(prod['conversations']['member_count_histogram'].keys(),
       prod['conversations']['member_count_histogram'].values(),
       alpha=0.5, label='Production')
ax.legend()
plt.savefig('comparison.png')
EOF

open comparison.png  # Visual inspection
```

**Problem**: Pilot dataset shows insufficient heavy room concentration

**Solution**: Increase heavy room percentage

```bash
jq '.conversations.heavy_rooms.percentage = 0.03' distribution-spec-calibrated.json > distribution-spec-calibrated-v2.json
```

---

## 📚 Reference Documents

- **Production Sampler**: `scripts/synthetic-data/production-sampler.ts` (581 lines)
- **Generator**: `scripts/synthetic-data/generator.ts` (529 lines)
- **Fidelity Validator**: `scripts/synthetic-data/validate-dataset-fidelity.ts` (650 lines)
- **Distribution Spec**: `scripts/synthetic-data/distribution-spec.json`
- **Workflow Guide**: `docs/database/QA_PERFORMANCE_WORKFLOW.md` (420 lines)

---

## 🎯 Next Steps

1. **Extract Production Shape** (if production data available)

   ```bash
   ts-node production-sampler.ts --output shape-metrics-prod.json --window-days 30
   ```

2. **Or Use Default Spec** (if no production access)

   ```bash
   # Skip calibration, use pre-configured distribution-spec.json
   ts-node generator.ts --band dev --seed dev_baseline_20251022
   ```

3. **Validate & Iterate**

   ```bash
   ts-node validate-dataset-fidelity.ts --config report_dev_*.json --tolerance 0.15
   ```

4. **Scale to Staging**
   ```bash
   ts-node generator.ts --band staging --seed staging_20251022
   ```

---

**Status**: 🟢 **READY FOR PRODUCTION SHAPE EXTRACTION**

Framework complete for privacy-safe sampling and synthetic calibration. Choose path based on production access:

- **Path A** (recommended): Extract production shape → Calibrate → Generate
- **Path B** (fallback): Use default spec → Generate → Validate

**First Command** (Path B, no production required):

```bash
cd /Users/harishraghave/Desktop/colleging/college-id-signup-1/scripts/synthetic-data
ts-node generator.ts --band dev --seed dev_baseline_20251022
```
