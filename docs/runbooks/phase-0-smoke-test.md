# Phase-0 Smoke Test Playbook

**Goal**: Validate chat backend readiness after a deploy or environment change in < 15 minutes.

---

## Prerequisites

- Access to Phase-0 Grafana dashboard (`UID: chat-phase-0`).
- Ability to run `scripts/run-smoke-tests.ts` or equivalent CLI.
- PagerDuty on-call rotation notified of scheduled test window.

---

## Checklist

1. **Health endpoint**
   - `curl -s https://<host>/health` returns `status: OK`.
   - Verify `/metrics` responds with HTTP 200 and contains `ws_connections` line.
2. **Authenticated socket handshake**
   - Use smoke script or `scripts/run-smoke-tests.ts --stage phase0`.
   - Confirm handshake success (HTTP 101 + socket connect) and no errors emitted.
   - Check Grafana panel “Active WS Connections” for a +1 blip.
3. **Message round-trip**
   - Send 10 messages with alternating history fetches.
   - Validate responses include `message_sent` and `messages_read` events.
   - Ensure `message_throughput_total` counters advance (Prom query).
4. **Metrics & logs**
   - Open Grafana latency panel: send/history p95 < SLO thresholds.
   - Structured logs (Loki/CloudWatch) show correlation IDs for the smoke session.
5. **Alert posture**
   - Confirm no WARN/PAGE alerts fire in Alertmanager / PagerDuty.
   - Acknowledge any noisy alerts and note for follow-up.

---

## Exit Criteria

- All steps pass without manual retries.
- `ws_connections` returns to baseline after disconnect.
- Dashboard screenshots captured for Phase-0 sign-off report.
- Any deviations documented in incident log with owner + resolution plan.
