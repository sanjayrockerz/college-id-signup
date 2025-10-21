# Performance Comparison Dashboard

Populate this dashboard with actual metrics after executing the new load tests. All values should reflect identical test scenarios and environment settings as the baseline for accurate comparison.

| Metric | Baseline (Pre-Transform) | Current | Delta % | SLO Target | Status | Notes |
|--------|--------------------------|---------|---------|------------|--------|-------|
| Send latency p50 (ms) |  |  |  | < 150 |  |  |
| Send latency p95 (ms) |  |  |  | < 250 |  |  |
| Send latency p99 (ms) |  |  |  | < 500 |  |  |
| History latency p50 (ms) |  |  |  | < 200 |  |  |
| History latency p95 (ms) |  |  |  | < 350 |  |  |
| History latency p99 (ms) |  |  |  | < 600 |  |  |
| Error rate (%) |  |  |  | < 0.1 |  |  |
| Throughput (req/s) |  |  |  | > 100 |  |  |
| CPU utilization (%) |  |  |  | 80 max |  |  |
| Memory consumption (GB) |  |  |  | < 75% usage |  |  |
| Build time (min) |  |  |  | < baseline |  |  |
| Bundle size (MB) |  |  |  | < baseline |  |  |

Status legend:

- ✅ Met SLO and improved >10% over baseline
- ⚠️ Met SLO, delta within ±10% of baseline (acceptable)
- ❌ Failed SLO or regressed >10% relative to baseline

## How to Calculate Delta %

```
Delta % = ((Current - Baseline) / Baseline) * 100
```

Use negative percentages to indicate improvements (lower latency, lower resource usage) and positive percentages for regressions unless the metric is “higher is better” (e.g., throughput).

## Evidence Checklist

- [ ] Attach raw load test outputs (`performance-metrics.json`)
- [ ] Attach load-test visualizations (`load-test-report.html`)
- [ ] Provide build/bundle measurements
- [ ] Note any test environment deviations

## Observations

1. <!-- Highlight standout improvements -->
2. <!-- Document borderline metrics that need monitoring -->
3. <!-- Mention any blocked follow-up investigations -->
