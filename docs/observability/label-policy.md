# Metric Label Policy

**Version**: 2025-10-22  
**Owner**: SRE / Reliability Guild  
**Scope**: Chat backend (Phase-0 telemetry)

---

## Goals

- Guarantee stable Prometheus cardinality (< 500 active series per job, < 5k aggregate) to keep query latency < 250 ms.
- Ensure labels are human-actionable (endpoint or event family + environment) with no user-specific values.
- Provide a contract that CI enforces so new metrics cannot introduce unbounded labels.

---

## Allowed Labels

| Label         | Description                                                                                               | Cardinality guardrail |
| ------------- | --------------------------------------------------------------------------------------------------------- | --------------------- |
| `environment` | Deployment tier (`development`, `test`, `staging`, `production`)                                          | ≤ 4                   |
| `instance`    | Runtime instance identifier (e.g. `chat-api-01`)                                                          | ≤ 20                  |
| `event`       | Discrete operational event family (`handshake.accepted`, `handshake.rejected`, `send_message`, `history`) | ≤ 12                  |
| `endpoint`    | Normalised HTTP route template (e.g. `POST /api/v1/chat/conversations/:id/messages`)                      | ≤ 40                  |
| `type`        | Message operation classification (`send`, `history`, `delivered`, `read`)                                 | 4                     |

**Forbidden labels** (enforced via CI script): `userId`, `conversationId`, `socketId`, `requestId`, free-form text, or anything derived from user input.

---

## Cardinality Budget

| Metric                     | Max series | Notes                                                             |
| -------------------------- | ---------- | ----------------------------------------------------------------- |
| `ws_connections`           | 80         | `environment × instance` (≤20 instances)                          |
| `message_throughput_total` | 320        | `environment × instance × type`                                   |
| `delivery_latency_ms`      | 480        | `environment × instance × event`, histogram buckets fixed         |
| `error_total`              | 640        | `environment × instance × event`, includes WARN and ERROR classes |
| `handshake_total`          | 160        | `environment × instance × result`                                 |
| `socket_disconnect_total`  | 320        | `environment × instance × reason`                                 |

Budget buffer (20%) reserved for canary experiments; exceeding budgets triggers a CI failure and requires SRE approval.

---

## Implementation Guarantees

1. **Normalisation**: HTTP endpoints must use route templates (e.g. replace IDs with `:id`). Socket events must use a fixed enum.
2. **Registry Review**: Every metric is registered inside `src/observability/metrics-registry.ts`; label lists are centralised for automated auditing.
3. **CI Enforcement**: `npm run ci:validate-telemetry` blocks merges when new labels fall outside the allow-list or when a metric declares > 4 labels.
4. **Runtime Safeguards**: Metric update helpers only accept union-typed values, preventing ad-hoc strings from runtime paths.

---

## Change Control

- **Minor edits** (updating description, adding event values within budget): review by reliability engineer.
- **New labels / metrics**: require RFC with load/cost analysis and agreement from observability + platform teams.
- **Emergency overrides**: allowed for incident response with retroactive review within 24 h.

---

## Audit Checklist

- [ ] Added or modified labels appear in this policy.
- [ ] Budget table updated when metric permutations change.
- [ ] CI script pass confirmed (`npm run ci:validate-telemetry`).
- [ ] Grafana dashboard reflects new/renamed labels.

---

_Last reviewed_: 2025-10-22  
_Next review_: 2026-01-15
