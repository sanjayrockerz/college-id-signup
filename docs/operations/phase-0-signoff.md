# Phase-0 Readiness Sign-Off

**Date**: 2025-10-22  
**Release**: Phase-0 (telemetry + reliability hardening)

---

## 1. Smoke Test Evidence

- Runbook: [`docs/runbooks/phase-0-smoke-test.md`](../runbooks/phase-0-smoke-test.md)
- Execution timestamp: ********\_\_\_\_********
- Results summary: ✅ / ⚠️
- Attached artefacts: Grafana screenshot (connections, latency), `/metrics` scrape excerpt.

## 2. Canary Analysis

- Runbook: [`docs/runbooks/phase-0-canary-checklist.md`](../runbooks/phase-0-canary-checklist.md)
- 5% window metrics: error rate **\_\_**, send p95 **\_\_** ms, history p95 **\_\_** ms
- 25% window metrics: error rate **\_\_**, send p95 **\_\_** ms, history p95 **\_\_** ms
- Full rollout metrics: error rate **\_\_**, send p95 **\_\_** ms, history p95 **\_\_** ms
- Rollback required? Yes / No (if yes, link to incident)

## 3. SLO & Alert Validation

- SLO policy: [`docs/observability/slo-policy.md`](../observability/slo-policy.md)
- Error budget status: ****\_**** (remaining %)
- Alert tests performed:
  - [ ] Handshake success page/warn
  - [ ] Latency WARN/PAGE
  - [ ] Error rate WARN/PAGE
  - [ ] Budget burn
- Runbook links embedded in alerts verified.

## 4. Telemetry & Dashboard

- Metrics endpoint validated: `/metrics` returns Prometheus text with `ws_connections`, `message_throughput_total`, `delivery_latency_ms`, `error_total`, `handshake_total`.
- Dashboard import: [`docs/dashboards/phase-0.json`](../dashboards/phase-0.json)
- Annotations recorded for deploy and canary windows.

## 5. Configuration Guardrails

- Module allowlist enforced (`chat` only): ✅ / ⚠️
- Label policy check (`npm run ci:validate-telemetry`): ✅ / ⚠️
- Forbidden flag scan (`npm run ci:verify-prod-flags`): ✅ / ⚠️

## 6. Decision

- [ ] Approve promotion to Phase-1 (horizontal scale work may begin)
- [ ] Blocker found → open follow-up ticket: ********\_\_\_\_********

**Signatories**:  
Reliability Lead ********\_\_\_\_********  
Release Engineer ********\_\_\_\_********  
Product Owner ********\_\_\_\_********
