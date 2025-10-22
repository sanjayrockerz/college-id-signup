# Production Shape Sampling Architecture

## System Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PRODUCTION ENVIRONMENT                               │
│                         (INSIDE TRUST BOUNDARY)                              │
│                                                                              │
│  ┌────────────────┐                                                         │
│  │  Production DB │                                                         │
│  │                │                                                         │
│  │  • Real users  │                                                         │
│  │  • Real convos │                                                         │
│  │  • Real msgs   │                                                         │
│  └───────┬────────┘                                                         │
│          │                                                                   │
│          │ ① QUERY (read-only)                                              │
│          │    - Aggregate GROUP BY                                          │
│          │    - COUNT, percentiles                                          │
│          │    - NO individual rows                                          │
│          ▼                                                                   │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  production-shape-sampler.ts                                         │  │
│  │                                                                      │  │
│  │  Security:                                                           │  │
│  │  • Requires ANONYMIZATION_SALT (32+ char secret)                    │  │
│  │  • HMAC-SHA256 for all identifiers                                  │  │
│  │  • NO raw IDs, emails, or content exported                          │  │
│  │                                                                      │  │
│  │  Extraction:                                                         │  │
│  │  • Histogram buckets (username length, content length)              │  │
│  │  • Percentiles (p50, p75, p90, p95, p99)                           │  │
│  │  • Type distributions (DM vs Group, TEXT vs IMAGE)                  │  │
│  │  • Temporal patterns (hourly, day-of-week)                          │  │
│  └──────────────────────────────────────────┬───────────────────────────┘  │
│                                               │                              │
│                                               │ ② OUTPUT                     │
│                                               │    (aggregate only)          │
└───────────────────────────────────────────────┼──────────────────────────────┘
                                                 │
                                                 ▼
                                    ┌────────────────────────┐
                                    │ shape-metrics-prod.json│◄─ SAFE TO EXPORT
                                    │                        │   (NO PII)
                                    │ • Histograms           │
                                    │ • Percentiles          │
                                    │ • Type distributions   │
                                    │ • Temporal patterns    │
                                    └────────┬───────────────┘
                                             │
                                             │ ③ COPY TO DEV
                                             │    (encrypted)
┌────────────────────────────────────────────┼────────────────────────────────┐
│                         DEV ENVIRONMENT                                      │
│                                            │                                 │
│                                            ▼                                 │
│                             ┌──────────────────────────────────────────┐    │
│                             │  calibrate-generator.ts                  │    │
│                             │                                          │    │
│                             │  Parametric Modeling:                    │    │
│                             │  • Power-law for messages/convo (alpha)  │    │
│                             │  • Log-normal for content length         │    │
│                             │  • Normal for username length            │    │
│                             │  • Normalized type distributions         │    │
│                             │                                          │    │
│                             │  Method:                                 │    │
│                             │  • Fit alpha from percentile ratios      │    │
│                             │  • Extract mean/stddev from histograms   │    │
│                             │  • Normalize counts to probabilities     │    │
│                             └──────────┬───────────────────────────────┘    │
│                                        │                                     │
│                                        │ ④ OUTPUT                            │
│                                        ▼                                     │
│                             ┌──────────────────────┐                        │
│                             │calibrated-config.json│                        │
│                             │                      │                        │
│                             │ • alpha = 1.85       │                        │
│                             │ • DM: 78%, Group: 22%│                        │
│                             │ • TEXT: 85%, IMG: 10%│                        │
│                             └──────────┬───────────┘                        │
│                                        │                                     │
│                                        │ ⑤ CONFIGURE                         │
│                                        ▼                                     │
│                          ┌───────────────────────────────────────┐          │
│                          │  generator.ts / quick-generator.ts    │          │
│                          │                                       │          │
│                          │  Generation Strategy:                 │          │
│                          │  • Use calibrated power-law alpha     │          │
│                          │  • Apply production type ratios       │          │
│                          │  • Match temporal patterns            │          │
│                          │  • Scale to target volume             │          │
│                          └───────────┬───────────────────────────┘          │
│                                      │                                       │
│                                      │ ⑥ GENERATE                            │
│                                      ▼                                       │
│                          ┌────────────────────┐                             │
│                          │   Dev Database     │                             │
│                          │                    │                             │
│                          │  • 5,000 users     │                             │
│                          │  • 8,000 convos    │                             │
│                          │  • 500K messages   │                             │
│                          │                    │                             │
│                          │  (SYNTHETIC DATA)  │                             │
│                          └───────────┬────────┘                             │
│                                      │                                       │
│                                      │ ⑦ VALIDATE                            │
│                                      ▼                                       │
│                          ┌────────────────────────────────────────┐         │
│                          │  validate-fidelity.ts                  │         │
│                          │                                        │         │
│                          │  Statistical Tests:                    │         │
│                          │  • Chi-Square (conversation types)     │         │
│                          │  • KS Test (messages per convo)        │         │
│                          │  • Chi-Square (message types)          │         │
│                          │  • Error % (content length)            │         │
│                          │                                        │         │
│                          │  Decision Logic:                       │         │
│                          │  • 4/4 pass → PASS                     │         │
│                          │  • 3/4 pass → WARNING                  │         │
│                          │  • <3 pass → FAIL (iterate)            │         │
│                          └───────────┬────────────────────────────┘         │
│                                      │                                       │
│                                      │ ⑧ OUTPUT                              │
│                                      ▼                                       │
│                          ┌────────────────────┐                             │
│                          │fidelity-report.json│                             │
│                          │                    │                             │
│                          │ Verdict: PASS ✓    │                             │
│                          │ • Chi-Sq: 2.45     │                             │
│                          │ • KS: 0.082        │                             │
│                          │ • Errors: <15%     │                             │
│                          └────────────────────┘                             │
│                                      │                                       │
│                                      ├─ PASS → Phase 2 Index Testing        │
│                                      └─ FAIL → Adjust alpha, regenerate     │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Privacy Boundaries

```
┌──────────────────────────────────────┐
│     PRODUCTION (PRIVATE ZONE)        │
│                                      │
│  ✓ Full user data                   │
│  ✓ Real message content              │
│  ✓ Personal identifiers              │
│  ✓ Conversation metadata             │
│                                      │
│  ❌ CANNOT EXPORT DIRECTLY           │
└──────────┬───────────────────────────┘
           │
           │ Anonymization Layer
           │ (HMAC-SHA256, aggregation)
           │
           ▼
┌──────────────────────────────────────┐
│     AGGREGATE METRICS (PUBLIC)       │
│                                      │
│  ✓ Histogram buckets                │
│  ✓ Percentiles (p50, p90, p99)      │
│  ✓ Type distributions               │
│  ✓ Temporal aggregates              │
│                                      │
│  ✅ SAFE TO EXPORT (NO PII)         │
└──────────┬───────────────────────────┘
           │
           │ Copy to dev
           │
           ▼
┌──────────────────────────────────────┐
│     DEV ENVIRONMENT                  │
│                                      │
│  ✓ Calibrate generator              │
│  ✓ Generate synthetic data          │
│  ✓ Validate fidelity                │
│  ✓ Run Phase 2 tests                │
│                                      │
│  ✅ NO PRODUCTION DATA               │
└──────────────────────────────────────┘
```

## Data Transformation Pipeline

```
Raw Production Data             Aggregate Metrics              Parametric Models
─────────────────              ─────────────────              ─────────────────

User {                         username_length_histogram:     Normal Distribution:
  id: "abc123",                  "5-9": 2300,         →         mean: 8.5
  email: "user@ex.com",   →      "10-14": 1800,      →         stddev: 2.3
  username: "johndoe"            "15-19": 900
}

Conversation {                 messages_per_convo_percentiles: Power-Law:
  id: "xyz789",                  p50: 45,            →         alpha: 1.85
  name: "Team Chat",    →        p90: 450,           →         min: 1
  messages: [...]                p99: 5000                    max: 15000
}

Message {                      content_length_stats:           Log-Normal:
  id: "msg001",                  mean: 85,           →         mean: 85
  content: "Hello!",    →        median: 42,         →         median: 42
  senderId: "abc123"             p95: 280                     p95: 280
}

Message {                      type_distribution:              Normalized Probs:
  type: "TEXT"          →        TEXT: 1020000       →         TEXT: 0.85
}                                IMAGE: 120000                IMAGE: 0.10
                                 FILE: 36000                  FILE: 0.03
```

## Statistical Validation Flow

```
Production Shape Metrics        Synthetic Dataset              Test Results
────────────────────────        ─────────────────              ────────────

Conversation Types:             Conversation Types:            Chi-Square Test:
  DM: 12500 (78.1%)    ────►      DM: 5600 (78.3%)   ────►      χ² = 2.45
  Group: 3500 (21.9%)             Group: 1560 (21.7%)           p = 0.29 → PASS

Messages/Convo:                 Messages/Convo:                KS Test:
  p50: 45              ────►      p50: 47            ────►      D = 0.082
  p90: 450                        p90: 485                     Error = 12% → PASS
  p99: 5000                       p99: 5150

Content Length:                 Content Length:                Error %:
  mean: 85             ────►      mean: 89           ────►      4.7% → PASS
  median: 42                      median: 44                   4.8% → PASS

                                                               Overall: PASS ✓
```

## Iteration Loop

```
Initial Parameters
       ↓
   Generate → Validate ─┬─ PASS → Proceed to Phase 2
       ↑                │
       │                └─ FAIL
       │                    ↓
       │              Analyze Errors
       │                    ↓
       │           ┌────────┴────────┐
       │           │                 │
       │      p99 too low       p50 too high
       │           │                 │
       │     Decrease alpha    Increase alpha
       │           │                 │
       │      (heavier tail)   (lighter tail)
       │           │                 │
       │           └────────┬────────┘
       │                    │
       └────── Adjust ──────┘
            Parameters
```

## Tool Integration

```
┌────────────────────────────────────────────────────────────────┐
│                   Synthetic Data Toolkit                       │
│                                                                │
│  Production Tools (secure):                                    │
│  • production-shape-sampler.ts ─────► shape-metrics.json       │
│                                                                │
│  Calibration Tools (dev):                                      │
│  • calibrate-generator.ts ──────────► calibrated-config.json   │
│                                                                │
│  Generation Tools (existing):                                  │
│  • generator.ts ─────────────────┐                            │
│  • quick-generator.ts ────────────┼──► Dev Database            │
│                                   │                            │
│  Validation Tools (new):          │                            │
│  • validate-fidelity.ts ──────────┴──► fidelity-report.json    │
│                                                                │
│  Phase 2 Tools (existing):                                     │
│  • verify-index-performance.ts ──────► baseline-reports/       │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

## Success Path

```
Step 1: Production Extraction
   ↓ (shape-metrics.json)

Step 2: Calibration
   ↓ (calibrated-config.json)

Step 3: Generation
   ↓ (500K-5M synthetic messages)

Step 4: Validation
   ↓ (fidelity-report.json: PASS)

Step 5: Phase 2 Index Testing
   ↓ (baseline-pre.json)

Step 6: Apply Indexes
   ↓ (phase-2-indexes.sql)

Step 7: Measure Improvements
   ↓ (baseline-post.json)

Step 8: GO/NO-GO Decision
   ✓ (60-70% latency reduction)
```

---

**Legend**:

- `───►` Data flow
- `─────` Process flow
- `┌──┐` Component/tool
- `✓` Success/approval
- `❌` Forbidden action
- `⚠️` Warning/caution
