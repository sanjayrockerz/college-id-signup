# Phase-0 Canary Validation Checklist

**Objective**: Validate staged rollout (5% → 25% → 100%) with automated rollback criteria.

---

## Pre-Canary

- [ ] Confirm smoke test passed within last 24 hours (see `phase-0-smoke-test.md`).
- [ ] Deploy annotation prepared (`/deploy annotate phase0 <version>`).
- [ ] Alerting and dashboard links verified.

---

## Step 1 — 5% Traffic

1. Shift 5% of traffic to new release (feature flag or LB weight).
2. Observe metrics for 10 minutes:
   - Error rate delta ≤ +0.05% absolute.
   - Send/history p95 latency delta ≤ +10%.
3. If thresholds exceeded, rollback immediately and file incident.

---

## Step 2 — 25% Traffic

1. Increase share to 25%.
2. Monitor for 15 minutes:
   - Error rate delta ≤ +0.1%.
   - Latency delta ≤ +15%.
   - Handshake success ≥ 99.9%.
3. Trigger rollback if any limit exceeded or alerts fire.

---

## Step 3 — 100% Traffic

1. Flip remaining traffic once KPIs stable.
2. Watch for 30 minutes:
   - Error rate ≤ 0.2% absolute.
   - Send p95 latency ≤ 250 ms, history p95 ≤ 350 ms.
   - No PagerDuty PAGE alerts triggered.
3. Confirm new baseline captured in Grafana dashboard screenshot.

---

## Auto-Rollback Criteria

- Error rate > 0.2% for 5 consecutive minutes.
- Send latency p95 increases by >20% relative to baseline snapshot.
- Handshake success < 99.8%.
- Any PAGE alert fired during canary window.

Rollback command reference recorded in deployment runbook (`scripts/deploy/rollback-phase0.sh`).

---

## Post-Canary Sign-Off

- [ ] Update Phase-0 sign-off report with metrics & screenshots.
- [ ] Remove deploy annotations or mark as `completed`.
- [ ] Notify stakeholders (Slack #phase0-release) with summary.
