# Phase-0 Service Level Objectives

**Version**: 2025-10-22  
**Owner**: Reliability Engineering  
**Applies to**: Chat Backend (WebSocket + HTTP) Phase-0 rollout

---

## Objectives Summary

| SLO                                 | Target                              | Measurement                                                                                    | Notes                                                          |
| ----------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------- | ------- | ------------------ | ------------- |
| **Authenticated handshake success** | ≥ 99.9% over rolling 30 days        | `1 - (rate(handshake_total{event="handshake.rejected"}[5m]) / rate(handshake_total[5m]))`      | Planned maintenance windows annotated & removed from numerator |
| **Message send latency (p95)**      | ≤ 250 ms (5 min window)             | `histogram_quantile(0.95, sum(rate(delivery_latency_ms_bucket{event="send"}[5m])) by (le))`    | Hard fail at 300 ms                                            |
| **History fetch latency (p95)**     | ≤ 350 ms (5 min window)             | `histogram_quantile(0.95, sum(rate(delivery_latency_ms_bucket{event="history"}[5m])) by (le))` | Hard fail at 400 ms                                            |
| **Message error rate**              | ≤ 0.1% (send + history + delivered) | `sum(rate(error_total{event=~"send_message                                                     | history                                                        | delivery"}[5m])) / sum(rate(message_throughput_total{type=~"send | history | delivered"}[5m]))` | WARN at 0.08% |

Availability SLO budgets are calculated across a 28-day window with 120-minute total error allowance (0.1%). Budget burn is monitored continuously.

---

## Error Budget Policy

- **Burn rate targets**:
  - **Normal**: ≤ 1× burn rate (budget spreads evenly across 28 days).
  - **Warning**: 2× burn rate sustained for ≥ 30 minutes.
  - **Critical**: 5× burn rate sustained for ≥ 10 minutes (pages primary on-call).
- **Freeze triggers**: Any critical breach pauses new deploys until a corrective action is executed and validated.

---

## Measurement & Tooling

- **Metrics Source**: Prometheus scraping `/metrics` every 15 seconds.
- **Dashboards**: `docs/dashboards/phase-0.json` (Grafana UID `chat-phase-0`).
- **Alerts**: See `config/alerting/phase-0-alerts.yml` and PagerDuty service `chat-backend-phase0`.
- **CI Hooks**: `npm run ci:validate-telemetry` + regression gates verifying latency & error thresholds on smoke tests.

---

## Exclusions & Planned Downtime

- Planned maintenance windows must be annotated via Grafana deploy annotations and excluded from compliance calculations.
- Client-side or upstream authentication failures beyond the gateway boundary are excluded if confirmed (evidence required).

---

## Review Cadence

- **Weekly**: Review burn-rate dashboard & annotate notable spikes.
- **Monthly**: Formal SLO review; adjust targets if service posture changes.
- **Incident Postmortems**: Include impact on error budget and remedial actions.

---

## Change Control

1. Proposed SLO changes require RFC with historical data and cost/risk assessment.
2. Approval required from Reliability Lead + Product Owner.
3. Update this document, alert rules, and dashboard thresholds simultaneously.

---

_Last updated_: 2025-10-22  
_Next review_: 2026-01-15
