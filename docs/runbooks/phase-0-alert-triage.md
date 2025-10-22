# Phase-0 Alert Triage Guide

Use this guide when alerts defined in `config/alerting/phase-0-alerts.yml` trigger. Each section maps to an alert annotation anchor.

---

## Handshake Failure Spikes

1. **Immediate checks**
   - Inspect Grafana “Active WS Connections” for drop or surge.
   - Query Prometheus: `rate(handshake_total{event="handshake.rejected"}[5m])`.
   - Verify upstream auth issuer / JWKS endpoints availability.
2. **Likely causes**
   - Expired or rotated signing keys not deployed.
   - Gateway misrouting traffic to legacy module (check allowlist logs).
   - Network ACL blocks between gateway and chat backend.
3. **Mitigation**
   - Roll back to previous known-good release if deploy-related.
   - Refresh JWKS cache or redeploy auth config.
   - Coordinate with network team to restore connectivity.
4. **Post-resolution**
   - Document root cause in incident tracker.
   - Update telemetry notes if new error fingerprint observed.

---

## Transport Errors

1. **Immediate checks**
   - PromQL: `sum(rate(error_total{event="delivery"}[5m]))`.
   - Inspect Socket.IO logs for disconnect reasons.
   - Review infrastructure events (scaling, node restarts).
2. **Likely causes**
   - Redis/pub-sub unavailable causing delivery failures.
   - Sudden client reconnect storm (consider rate limiting).
   - Network saturation on egress.
3. **Mitigation**
   - Shift traffic to healthy AZ/cluster (if available).
   - Enable connection shedding (reduce max concurrent connections temporarily).
   - Notify clients of degraded mode if persistent.
4. **Post-resolution**
   - Record duration and impact in runbook tracker.
   - Evaluate need for additional buffering / back-pressure.

---

## Latency Creep

1. **Immediate checks**
   - Grafana latency panel for send/history quantiles.
   - Database monitoring (connection pool, slow queries).
   - PromQL: `histogram_quantile(0.95, sum(rate(delivery_latency_ms_bucket{event="send"}[5m])) by (le))`.
2. **Likely causes**
   - Database contention / missing index.
   - Downstream services (storage, attachment service) slow.
   - Unoptimised code path introduced in latest deploy.
3. **Mitigation**
   - Scale DB read replicas or increase pool size within guardrails.
   - Roll back offending release if regression confirmed.
   - Apply hotfix (feature flag gating, caching).
4. **Post-resolution**
   - Capture flamegraphs / query plans for RCA.
   - Update performance budget records.

---

## Budget Burn

1. **Immediate checks**
   - Evaluate burn-rate query: `error_rate / 0.001` from alert annotation.
   - Aggregate across endpoints to identify dominant contributor.
   - Confirm no simultaneous upstream incidents.
2. **Mitigation**
   - Enforce deploy freeze, notify release manager.
   - Initiate targeted rollback or canary to isolate issue.
   - If external dependency outage, coordinate comms & status page updates.
3. **Recovery**
   - Maintain burn < 1× for next 24h before lifting freeze.
   - Review runbook updates or additional automation needed.
