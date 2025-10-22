# Runtime Environment Contract

Phase 0 hardening establishes a single, validated source of truth for all runtime configuration. The `src/config/environment.ts` module parses `process.env`, enforces schema, fails fast on invalid or missing values, and emits one sanitized `resolvedConfig` audit event per process with a correlation ID. This document enumerates the contract, precedence rules, and profile examples for development, staging, and production.

---

## 1. Precedence & Lifecycle

1. **Overrides** (when tests call `loadEnvironment(overrides)`)
2. **`process.env`** (injected by shell, CI, or orchestrator)
3. **Defaults** defined in `environment.ts`

On bootstrap `loadEnvironment()`:

- Validates required variables and allowed ranges.
- Rejects forbidden flags when `NODE_ENV=production`.
- Ensures `ACTIVE_MODULE` is within the `ALLOWED_MODULES` allowlist.
- Verifies an authentication key source exists (`JWKS_URL` or `PUBLIC_KEYS`).
- Emits a single JSON info log: `{ event: "resolvedConfig", ... }` with masked secrets and `correlationId`.

If validation fails, the service terminates before creating the Nest application.

---

## 2. Variable Reference

| Category  | Variable                   | Required | Default       | Sensitivity | Notes                                                        |
| --------- | -------------------------- | -------- | ------------- | ----------- | ------------------------------------------------------------ | --- | -------------------------- |
| Service   | `NODE_ENV`                 | No       | `development` | Public      | `development` \| `test` \| `production`                      |
| Service   | `PORT`                     | No       | `3001`        | Public      | 1024-65535                                                   |
| Service   | `LOG_LEVEL`                | No       | `info`        | Public      | `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` |
| Service   | `ACTIVE_MODULE`            | No       | `app`         | Internal    | Must exist in `ALLOWED_MODULES`                              |
| Service   | `ALLOWED_MODULES`          | No       | `app,chat`    | Internal    | Comma-separated list                                         |
| Service   | `CORS_ORIGIN`              | No       | —             | Public      | CSV origins when overriding defaults                         |
| Auth      | `JWT_ISSUER`               | **Yes**  | —             | Internal    | Expected token issuer                                        |
| Auth      | `JWT_AUDIENCE`             | **Yes**  | —             | Internal    | Expected token audience                                      |
| Auth      | `JWKS_URL`                 | Cond.    | —             | Internal    | HTTPS JWKS endpoint (optional when `PUBLIC_KEYS` set)        |
| Auth      | `PUBLIC_KEYS`              | Cond.    | —             | Secret      | PEM blocks or shared secret (`                               |     | ` or blank line separated) |
| Auth      | `TOKEN_LEEWAY_SEC`         | No       | `30`          | Internal    | Clock skew tolerance (0-120)                                 |
| Database  | `DATABASE_URL`             | **Yes**  | —             | Secret      | PostgreSQL connection string                                 |
| Database  | `DB_POOL_MIN`              | No       | —             | Internal    | ≥0, must be ≤ `DB_POOL_MAX`                                  |
| Database  | `DB_POOL_MAX`              | No       | —             | Internal    | ≥1                                                           |
| Database  | `DB_CONNECTION_TIMEOUT_MS` | No       | —             | Internal    | ≥1000                                                        |
| Database  | `DB_IDLE_TIMEOUT_MS`       | No       | —             | Internal    | ≥1000                                                        |
| Telemetry | `METRICS_ENABLED`          | No       | `false`       | Internal    | Enables Prometheus/JSON metrics                              |
| Telemetry | `METRICS_PORT`             | No       | `9464`        | Internal    | Scrape port                                                  |
| Telemetry | `LOG_JSON`                 | No       | `true`        | Internal    | Emit structured logs                                         |
| Telemetry | `TRACE_ENABLED`            | No       | `false`       | Internal    | Enables tracing exporters                                    |
| Forbidden | `DISABLE_RATE_LIMIT`       | No       | `false`       | Internal    | **Blocked in production**                                    |
| Forbidden | `MOCK_MODE`                | No       | `false`       | Internal    | **Blocked in production**                                    |
| Forbidden | `DEV_SEED_DATA`            | No       | `false`       | Internal    | **Blocked in production**                                    |

**Sensitivity legend**:

- **Public** – safe to expose (e.g. docs, dashboards).
- **Internal** – operational data; avoid unbounded sharing.
- **Secret** – mask in logs, never commit to version control.

---

## 3. Profile Templates

### Development (`.env.local`)

```env
NODE_ENV=development
PORT=3001
LOG_LEVEL=debug
PUBLIC_KEYS=dev-shared-secret
JWT_ISSUER=https://dev-id.example.com/issuer
JWT_AUDIENCE=chat-backend
DATABASE_URL=postgresql://dev:dev@localhost:5432/chat_dev
DISABLE_RATE_LIMIT=true
METRICS_ENABLED=true
TRACE_ENABLED=false
```

### Staging (`.env.staging`)

```env
NODE_ENV=test
PORT=4000
LOG_LEVEL=info
JWKS_URL=https://id.staging.example.com/.well-known/jwks.json
JWT_AUDIENCE=chat-backend-staging
DATABASE_URL=postgresql://chat_stage:${DB_STAGE_PASSWORD}@staging-db:5432/chat
METRICS_ENABLED=true
TRACE_ENABLED=true
TOKEN_LEEWAY_SEC=20
```

### Production (`.env.production`)

```env
NODE_ENV=production
PORT=8080
LOG_LEVEL=warn
JWKS_URL=https://id.example.com/.well-known/jwks.json
JWT_AUDIENCE=chat-backend
DATABASE_URL=${DATABASE_URL}  # injected via orchestrator secret store
METRICS_ENABLED=true
LOG_JSON=true
TRACE_ENABLED=true
TOKEN_LEEWAY_SEC=15
ACTIVE_MODULE=chat
ALLOWED_MODULES=chat
```

> ⚠️ `DISABLE_RATE_LIMIT`, `MOCK_MODE`, and `DEV_SEED_DATA` must remain unset/false in production. The validator aborts boot if any flag is enabled while `NODE_ENV=production`.

---

## 4. Forbidden Flags & CI Gate

The Husky/CI guard (`npm run ci:verify-prod-flags`) scans deployment manifests, Docker/K8s specs, and workflow files for `DISABLE_RATE_LIMIT`, `MOCK_MODE`, or `DEV_SEED_DATA` hard-coded with truthy values. The guard fails pull requests so production manifests cannot disable safety controls.

---

## 5. Resolved Config Audit Event

Every process logs exactly one sanitized JSON record:

```json
{
  "event": "resolvedConfig",
  "version": "2025-10-22",
  "correlationId": "e7f6...",
  "service": {
    "nodeEnv": "production",
    "port": 8080,
    "logLevel": "warn",
    "activeModule": "chat",
    "allowedModules": ["chat"],
    "corsOrigins": ["https://chat.example.com"]
  },
  "auth": {
    "jwtIssuer": "https://id.example.com/issuer",
    "jwtAudience": "chat-backend",
    "jwksUrl": "https://id.example.com/…",
    "publicKeyCount": 0,
    "tokenLeewaySec": 15
  },
  "database": {
    "url": "pos***45",
    "poolMin": 4,
    "poolMax": 20
  },
  "telemetry": {
    "metricsEnabled": true,
    "metricsPort": 9464,
    "logJson": true,
    "traceEnabled": true
  },
  "flags": {
    "disableRateLimit": false,
    "mockMode": false,
    "devSeedData": false
  }
}
```

Use the `correlationId` when correlating runtime logs, handshake telemetry, and incident reviews.

---

## 6. Token Leeway Guidance

- Start with `TOKEN_LEEWAY_SEC=15` in production to balance clock skew and replay windows.
- Increase temporarily (≤30) only when clients exhibit systematic clock drift; investigate root cause.
- Monitor `socket_handshake_rejections{reason="expired"}` (exported through `/metrics`) to detect leeway misconfiguration.
- Document changes in change control and ensure client updates restore smaller leeway windows.

---

## 7. Quick Checklist

- [ ] Runtime secrets supplied via orchestrator secret store (not `.env` in production)
- [ ] `PUBLIC_KEYS` removed when using JWKS (avoid dual maintenance)
- [ ] Forbidden flags absent in all production artifacts (`npm run ci:verify-prod-flags`)
- [ ] Resolved config log observed once per process (verify in log aggregation)
- [ ] Token leeway documented per environment

Refer to `docs/runtime/socket-handshake-runbook.md` for handshake tuning, rejection histograms, and triage procedures.
