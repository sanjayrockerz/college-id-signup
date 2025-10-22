# Socket Handshake Runbook

This runbook covers telemetry signals, common failure modes, and tuning levers for the authenticated Socket.IO gateway introduced in Phase 0 hardening. It assumes the environment contract documented in `docs/runtime/environment-contract.md` is in effect.

---

## 1. Overview

The gateway enforces JSON Web Token (JWT) authentication during the Socket.IO handshake. Each attempt emits structured telemetry and the `SocketMetrics` collector records:

- `socket_handshake_total{status="accepted"|"rejected"}`
- `socket_handshake_rejections{reason}` – one of `missing_token`, `malformed_token`, `expired`, `not_yet_valid`, `unknown_issuer`, `audience_mismatch`, `verification_failed`, `rate_limited`, `internal_error`
- `socket_disconnect_total{reason}` – normalized disconnect reasons
- `socket_active_gauge` – current connected clients

Logs are correlated via `correlationId` included in the handshake middleware.

---

## 2. Triage Flow

1. **Alert Trigger** – Prometheus alert or log anomaly indicates handshake rejection spike.
2. **Confirm Metrics** – Query the rejection histogram to isolate dominant `reason` labels.
3. **Correlate Logs** – Search structured logs using `correlationId`. Expect entries from:

- `socket.handshake` (with `outcome` = `accepted` or `rejected`)
- `socket.connection`
- `socket.disconnect`

4. **Review Environment** – Verify runtime configuration via the last `resolvedConfig` log.
5. **Mitigate** – Apply fixes aligned with reason (see below). Document changes.

---

## 3. Common Rejection Reasons

| Reason                | Interpretation                      | Checks                       | Remediation                                                 |
| --------------------- | ----------------------------------- | ---------------------------- | ----------------------------------------------------------- |
| `missing_token`       | No `token` query/on headers         | Client instrumentation, CORS | Patch client, add integration test                          |
| `malformed_token`     | Not a JWT or invalid encoding       | Inspect client payload       | Ensure correct signing and URL encoding                     |
| `expired`             | Token `exp` < server clock - leeway | Clock skew, leeway           | Increase `TOKEN_LEEWAY_SEC` (temporary), sync client clocks |
| `not_yet_valid`       | `nbf` or `iat` in future            | Clock skew, issuance bugs    | Fix issuing service clock                                   |
| `unknown_issuer`      | `iss` mismatch                      | Runtime config mismatch      | Align `JWT_ISSUER` with IdP metadata                        |
| `audience_mismatch`   | `aud` mismatch                      | Client token request scope   | Update client request or server `JWT_AUDIENCE`              |
| `verification_failed` | JWT signature invalid               | Stale keys, wrong secret     | Refresh JWKS cache, rotate keys                             |
| `rate_limited`        | Rate limiter blocked handshake      | Burst traffic                | Raise limits temporarily, investigate abuse                 |
| `internal_error`      | Unexpected verifier error           | Service logs                 | Escalate to platform team, capture stack trace              |

---

## 4. Tuning Token Leeway

- Default leeway (`TOKEN_LEEWAY_SEC`) is 15 seconds.
- Use Grafana panel `Socket Handshake Rejections (expired)` to assess whether drift spikes coincide with deployments or incidents.
- Increase to 20–30 seconds only when validated clock drift is present.
- Set calendar reminder to revert leeway after client patches roll out.
- For downstream services in other regions, prefer to fix NTP configuration instead of raising leeway.

---

## 5. Metrics & Alerting Examples

### Prometheus Alert

```yaml
- alert: SocketHandshakeRejectionSpike
  expr: rate(socket_handshake_rejections_total[5m]) > 5
  for: 10m
  labels:
    severity: page
  annotations:
    summary: High rate of socket handshake rejections
    description: |
      socket_handshake_rejections_total exceeded 5/min for 10 minutes.
      Check rejection reasons, resolved config, and IdP health.
```

### Grafana Panels

- `socket_handshake_total` stacked by status
- `socket_handshake_rejections_total` grouped by reason
- `socket_active_gauge` with deployment markers
- Log panel filtered on `event: "socket.handshake"` (group by `outcome`)

---

## 6. Incident Checklist

- [ ] Confirm orchestrator propagated latest environment secret versions.
- [ ] Validate IdP JWKS availability and latency.
- [ ] Inspect certificate expiration when using JWKS.
- [ ] Run `/health` HTTP check to confirm service readiness unaffected.
- [ ] Review recent deploy diff for changes to auth middleware.
- [ ] Document root cause, timeline, and configuration adjustments in incident report.

---

## 7. Hugging the Guardrails

- Keep `DISABLE_RATE_LIMIT=false` in production; CI guard fails otherwise.
- Do not log raw tokens. Middleware only emits derived metadata and truncates key material.
- Schedule quarterly key rotation drills to verify JWKS and cache invalidation flow.
- Maintain E2E tests that perform a real handshake using staged credentials.

---

## 8. Contacts

- **Primary On-Call:** Platform Security Squad (`#oncall-auth`)
- **Secondary:** Realtime Messaging Team (`#rtm-infra`)
- **Escalation Path:** Incident commander via OpsGenie `Realtime Messaging` rotation.

Keep this runbook updated as new telemetry fields land or client handshake semantics change.
