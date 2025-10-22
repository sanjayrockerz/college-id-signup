# Observability Stack Specification

**Version**: 1.0  
**Effective Date**: 2025-10-20  
**Authority**: SRE Team  
**Review Cycle**: Quarterly

---

## Overview

This document defines the **observability infrastructure** for the chat backend, covering:
- Structured logging (application events, errors, audit trails)
- Metrics collection (throughput, latency, error rates, resource usage)
- Distributed tracing (request flows across services)
- Alerting (SLO violations, anomaly detection)

**Goals**:
- Achieve <5 min Mean Time to Detection (MTTD) for P1 incidents
- Enable <15 min Mean Time to Resolution (MTTR) with actionable insights
- Maintain <1% data loss for logs/metrics under normal conditions
- Provide 30-day retention for metrics, 90-day for logs

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Chat Backend                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  HTTP API    │  │  WebSocket   │  │  Background  │          │
│  │  Handlers    │  │  Gateway     │  │  Workers     │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                  │                  │                  │
│         └──────────────────┴──────────────────┘                  │
│                            │                                     │
│         ┌──────────────────┴──────────────────┐                 │
│         │    Observability Middleware         │                 │
│         │  - Logger (Winston/Pino)            │                 │
│         │  - Metrics (Prometheus Client)      │                 │
│         │  - Tracer (OpenTelemetry)           │                 │
│         └──────────────────┬──────────────────┘                 │
└────────────────────────────┼──────────────────────────────────┐
                             │                                     │
         ┌───────────────────┼───────────────────────┐             │
         │                   │                       │             │
         ▼                   ▼                       ▼             │
  ┌─────────────┐    ┌─────────────┐       ┌─────────────┐       │
  │  Logs       │    │  Metrics    │       │  Traces     │       │
  │  (JSON)     │    │  (Prom)     │       │  (OTLP)     │       │
  └──────┬──────┘    └──────┬──────┘       └──────┬──────┘       │
         │                   │                       │             │
         ▼                   ▼                       ▼             │
  ┌─────────────┐    ┌─────────────┐       ┌─────────────┐       │
  │ CloudWatch  │    │ Prometheus  │       │   Jaeger    │       │
  │  Logs       │    │   Server    │       │   Collector │       │
  └──────┬──────┘    └──────┬──────┘       └──────┬──────┘       │
         │                   │                       │             │
         │                   └───────┬───────────────┘             │
         │                           ▼                             │
         │                   ┌─────────────┐                       │
         │                   │   Grafana   │                       │
         │                   │  Dashboards │                       │
         │                   └──────┬──────┘                       │
         │                          │                              │
         └──────────────────────────┼──────────────────────────┐   │
                                    ▼                             │
                            ┌─────────────┐                       │
                            │  Alerting   │                       │
                            │  (PagerDuty │                       │
                            │  + Slack)   │                       │
                            └─────────────┘                       │
```

---

## 1. Structured Logging

### Requirements

| Requirement | Specification |
|-------------|---------------|
| **Format** | JSON (machine-parseable) |
| **Library** | Winston (Node.js) or Pino (high-performance) |
| **Destination** | AWS CloudWatch Logs (via CloudWatch Agent) |
| **Retention** | 90 days (30 days hot, 60 days cold storage) |
| **PII Handling** | Automatic redaction (see below) |
| **Correlation** | Request ID propagated across all log entries |

---

### Log Levels

Use **5 log levels** (RFC 5424 severity):

| Level | Use Case | Example |
|-------|----------|---------|
| **ERROR** | Unhandled exceptions, critical failures | `Database connection failed` |
| **WARN** | Degraded state, recoverable errors | `Retry attempt 3/5 failed` |
| **INFO** | Normal operations, state changes | `User connected to WebSocket` |
| **DEBUG** | Detailed diagnostic information | `Executing query: SELECT * FROM...` |
| **TRACE** | Ultra-verbose (disabled in production) | `Function entry: sendMessage(args)` |

**Production Defaults**:
- Normal mode: `INFO` level
- Debug mode (temporary): `DEBUG` level (via feature flag)
- Never use `TRACE` in production (performance impact)

---

### Log Format Schema

Every log entry MUST include:

```json
{
  "timestamp": "2025-10-20T14:32:15.123Z",
  "level": "INFO",
  "service": "chat-backend",
  "version": "1.2.3",
  "environment": "production",
  "requestId": "req-abc123",
  "traceId": "trace-xyz789",
  "spanId": "span-456",
  "userId": "user-123",
  "conversationId": "conv-456",
  "message": "Message sent successfully",
  "context": {
    "messageId": "msg-789",
    "duration_ms": 45,
    "endpoint": "POST /api/v1/chat/conversations/:id/messages"
  },
  "error": {
    "name": "ValidationError",
    "message": "Message content exceeds 5000 chars",
    "stack": "ValidationError: Message content...\n  at validate (src/chat/services/message.service.ts:45)"
  }
}
```

**Required Fields**:
- `timestamp`: ISO 8601 UTC
- `level`: ERROR | WARN | INFO | DEBUG
- `service`: Always `"chat-backend"`
- `version`: Semantic version (from package.json)
- `environment`: production | staging | development
- `requestId`: Unique per HTTP request (from middleware)
- `message`: Human-readable summary

**Optional Fields**:
- `userId`: If available in request context (NOT authenticated)
- `conversationId`: For chat-related operations
- `error`: Object with `name`, `message`, `stack` (only for ERROR level)
- `context`: Additional metadata (endpoint, duration, query params)

---

### PII Redaction

**Sensitive Data to Redact**:
- Email addresses
- Phone numbers
- IP addresses (keep first 2 octets only: `192.168.x.x`)
- Message content (log only `messageId`, not full text)

**Implementation**:
```typescript
// src/common/utils/logger.ts
import { createLogger, format, transports } from 'winston';

const redactPII = format((info) => {
  // Redact email addresses
  if (info.email) {
    info.email = info.email.replace(/(.{2}).*@/, '$1***@');
  }
  
  // Redact IP addresses (keep first 2 octets)
  if (info.ip) {
    info.ip = info.ip.replace(/(\d+\.\d+)\.\d+\.\d+/, '$1.x.x');
  }
  
  // Never log message content directly
  if (info.messageContent) {
    delete info.messageContent;
    info.warning = 'Message content redacted (PII protection)';
  }
  
  return info;
});

export const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    redactPII(),
    format.timestamp(),
    format.errors({ stack: true }),
    format.json()
  ),
  defaultMeta: {
    service: 'chat-backend',
    version: process.env.npm_package_version,
    environment: process.env.NODE_ENV
  },
  transports: [
    new transports.Console(),
    new transports.File({ filename: '/var/log/chat-backend/app.log' })
  ]
});
```

---

### Correlation IDs

**Request ID Middleware** (Express/NestJS):
```typescript
// src/middleware/request-id.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    req.id = req.headers['x-request-id'] || uuidv4();
    res.setHeader('X-Request-Id', req.id);
    next();
  }
}
```

**Usage in Logs**:
```typescript
logger.info('Message sent', {
  requestId: req.id,
  userId: req.headers['x-user-id'],
  messageId: message.id
});
```

---

### CloudWatch Integration

**Deployment**:
```yaml
# docker-compose.yml
services:
  chat-backend:
    logging:
      driver: awslogs
      options:
        awslogs-group: /aws/ecs/chat-backend
        awslogs-region: us-east-1
        awslogs-stream-prefix: chat
```

**Log Queries** (CloudWatch Insights):
```sql
-- Find all errors in last 1 hour
fields @timestamp, level, message, error.name
| filter level = "ERROR"
| sort @timestamp desc
| limit 100

-- Track request latency
fields @timestamp, requestId, context.duration_ms
| stats avg(context.duration_ms) as avg_latency, 
        max(context.duration_ms) as max_latency
  by bin(5m)

-- Count errors by type
fields error.name
| filter level = "ERROR"
| stats count() by error.name
| sort count desc
```

---

## 2. Metrics Collection

### Requirements

| Requirement | Specification |
|-------------|---------------|
| **Format** | Prometheus exposition format |
| **Library** | `prom-client` (Node.js) |
| **Scrape Interval** | 15 seconds |
| **Retention** | 30 days (1m resolution), 1 year (5m resolution) |
| **Cardinality** | <10,000 unique time series |

---

### Metric Types

| Type | Use Case | Example |
|------|----------|---------|
| **Counter** | Monotonically increasing value | `http_requests_total` |
| **Gauge** | Current value (can go up/down) | `websocket_connections_active` |
| **Histogram** | Distribution of values | `http_request_duration_seconds` |
| **Summary** | Like histogram, but client-side quantiles | Not recommended (use histogram) |

---

### Standard Metrics

#### HTTP API Metrics

```typescript
// src/common/services/metrics.service.ts
import { Counter, Histogram, Gauge, register } from 'prom-client';

export class MetricsService {
  // Request counter
  private readonly httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'endpoint', 'status']
  });

  // Request duration histogram
  private readonly httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'endpoint'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
  });

  // Active connections gauge
  private readonly websocketConnectionsActive = new Gauge({
    name: 'websocket_connections_active',
    help: 'Number of active WebSocket connections'
  });

  // Database query duration
  private readonly databaseQueryDuration = new Histogram({
    name: 'database_query_duration_seconds',
    help: 'Database query duration',
    labelNames: ['operation', 'table'],
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1]
  });

  // Record HTTP request
  recordHttpRequest(method: string, endpoint: string, status: number, duration: number) {
    this.httpRequestsTotal.inc({ method, endpoint, status });
    this.httpRequestDuration.observe({ method, endpoint }, duration);
  }

  // Update WebSocket connections
  setWebSocketConnections(count: number) {
    this.websocketConnectionsActive.set(count);
  }

  // Record database query
  recordDatabaseQuery(operation: string, table: string, duration: number) {
    this.databaseQueryDuration.observe({ operation, table }, duration);
  }
}
```

---

#### Business Metrics

```typescript
// Message throughput
private readonly messagesTotal = new Counter({
  name: 'chat_messages_total',
  help: 'Total messages sent',
  labelNames: ['conversation_type']  // 'direct' | 'group'
});

// Conversation creation rate
private readonly conversationsCreated = new Counter({
  name: 'chat_conversations_created_total',
  help: 'Total conversations created'
});

// Message size distribution
private readonly messageSize = new Histogram({
  name: 'chat_message_size_bytes',
  help: 'Message size in bytes',
  buckets: [100, 500, 1000, 5000, 10000, 50000]
});
```

---

### Metrics Endpoint

**Expose Prometheus scrape endpoint**:
```typescript
// src/common/controllers/metrics.controller.ts
import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { register } from 'prom-client';

@Controller('metrics')
export class MetricsController {
  @Get()
  async getMetrics(@Res() res: Response) {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  }
}
```

**Scrape Config** (Prometheus):
```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'chat-backend'
    scrape_interval: 15s
    static_configs:
      - targets: ['chat-backend.internal:3000']
    metrics_path: '/metrics'
```

---

### Cardinality Control

**High-Cardinality Labels to AVOID**:
- ❌ `userId` (millions of unique users)
- ❌ `messageId` (unbounded)
- ❌ `requestId` (unique per request)
- ❌ Full endpoint paths with IDs (`/conversations/123/messages`)

**Low-Cardinality Labels to USE**:
- ✅ `method` (GET, POST, PUT, DELETE)
- ✅ `endpoint` (route template: `/conversations/:id/messages`)
- ✅ `status` (200, 400, 500)
- ✅ `operation` (create, read, update, delete)
- ✅ `table` (messages, conversations)

**Normalize Endpoints**:
```typescript
// Replace /conversations/abc123/messages → /conversations/:id/messages
function normalizeEndpoint(path: string): string {
  return path
    .replace(/\/[a-f0-9-]{36}/g, '/:id')  // UUIDs
    .replace(/\/\d+/g, '/:id');            // Numeric IDs
}
```

---

## 3. Distributed Tracing

### Requirements

| Requirement | Specification |
|-------------|---------------|
| **Standard** | OpenTelemetry (OTLP) |
| **Backend** | Jaeger (self-hosted) or AWS X-Ray |
| **Sampling Rate** | 10% (production), 100% (staging) |
| **Retention** | 7 days |

---

### Span Structure

**Example Trace** (HTTP request → Database query):

```
Trace ID: trace-xyz789
├─ Span: POST /api/v1/chat/conversations/:id/messages  [45ms]
   ├─ Span: Validate request                           [2ms]
   ├─ Span: Check conversation exists                  [5ms]
   │  └─ Span: Database query: SELECT conversations    [4ms]
   ├─ Span: Insert message                             [35ms]
   │  └─ Span: Database query: INSERT messages         [32ms]
   └─ Span: Emit WebSocket event                       [3ms]
```

**Span Attributes**:
- `service.name`: `chat-backend`
- `http.method`: `POST`
- `http.route`: `/api/v1/chat/conversations/:id/messages`
- `http.status_code`: `201`
- `db.system`: `postgresql`
- `db.statement`: `INSERT INTO messages...`
- `db.operation`: `INSERT`
- `db.table`: `messages`

---

### Implementation

**Setup OpenTelemetry**:
```typescript
// src/infra/services/tracing.service.ts
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

export function initializeTracing() {
  const provider = new NodeTracerProvider({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: 'chat-backend',
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version
    })
  });

  const exporter = new JaegerExporter({
    endpoint: process.env.JAEGER_ENDPOINT || 'http://jaeger:14268/api/traces'
  });

  provider.addSpanProcessor(new BatchSpanProcessor(exporter));
  provider.register();
}
```

**Auto-Instrumentation** (HTTP, Database):
```typescript
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PrismaInstrumentation } from '@prisma/instrumentation';

registerInstrumentations({
  instrumentations: [
    new HttpInstrumentation(),
    new PrismaInstrumentation()
  ]
});
```

**Manual Spans**:
```typescript
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('chat-backend');

async function sendMessage(conversationId: string, content: string) {
  const span = tracer.startSpan('sendMessage');
  span.setAttribute('conversation.id', conversationId);
  span.setAttribute('message.length', content.length);

  try {
    const message = await this.prisma.message.create({ data: { ... } });
    span.setStatus({ code: SpanStatusCode.OK });
    return message;
  } catch (error) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    span.recordException(error);
    throw error;
  } finally {
    span.end();
  }
}
```

---

### Sampling Strategy

**Production** (10% sampling to reduce cost):
```typescript
import { TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';

const provider = new NodeTracerProvider({
  sampler: new TraceIdRatioBasedSampler(0.1)  // 10%
});
```

**Errors Always Sampled**:
```typescript
import { ParentBasedSampler, AlwaysOnSampler } from '@opentelemetry/sdk-trace-base';

// Sample all error traces
const sampler = new ParentBasedSampler({
  root: new TraceIdRatioBasedSampler(0.1),
  remoteParentSampled: new AlwaysOnSampler(),
  remoteParentNotSampled: (context) => {
    // Force sample if error detected
    const span = trace.getActiveSpan();
    if (span?.status?.code === SpanStatusCode.ERROR) {
      return { decision: SamplingDecision.RECORD_AND_SAMPLED };
    }
    return { decision: SamplingDecision.NOT_RECORD };
  }
});
```

---

## 4. Alerting

### Requirements

| Requirement | Specification |
|-------------|---------------|
| **Platform** | PagerDuty (P0/P1) + Slack (P2/P3) |
| **Response Time** | <5 min for P0, <15 min for P1 |
| **Alert Fatigue** | <10 alerts/day on-call |

---

### Alert Rules

#### Error Rate (P1)

```yaml
# prometheus-alerts.yml
groups:
  - name: chat-backend
    rules:
      - alert: HighErrorRate
        expr: |
          (
            sum(rate(http_requests_total{status=~"5.."}[5m]))
            /
            sum(rate(http_requests_total[5m]))
          ) > 0.01
        for: 5m
        labels:
          severity: P1
          service: chat-backend
        annotations:
          summary: "Error rate above 1%"
          description: "Current error rate: {{ $value | humanizePercentage }}"
          runbook: "https://github.com/company/docs/runbooks#elevated-error-rates"
```

**PagerDuty Integration**:
```yaml
receivers:
  - name: pagerduty
    pagerduty_configs:
      - service_key: <PAGERDUTY_SERVICE_KEY>
        severity: '{{ .GroupLabels.severity }}'
```

---

#### High Latency (P2)

```yaml
- alert: HighLatency
  expr: |
    histogram_quantile(0.95, 
      sum(rate(http_request_duration_seconds_bucket[5m])) by (le, endpoint)
    ) > 1.0
  for: 10m
  labels:
    severity: P2
  annotations:
    summary: "p95 latency above 1s for {{ $labels.endpoint }}"
    description: "Current p95: {{ $value }}s"
```

---

#### Connection Storm (P1)

```yaml
- alert: ConnectionStorm
  expr: websocket_connections_active > 1000
  for: 5m
  labels:
    severity: P1
  annotations:
    summary: "Abnormal WebSocket connection count"
    description: "Active connections: {{ $value }} (baseline: 200)"
```

---

#### Database Saturation (P1)

```yaml
- alert: DatabaseSaturation
  expr: |
    histogram_quantile(0.95,
      sum(rate(database_query_duration_seconds_bucket[5m])) by (le)
    ) > 0.5
  for: 5m
  labels:
    severity: P1
  annotations:
    summary: "Database query p95 latency > 500ms"
    description: "Current p95: {{ $value }}s"
```

---

### Slack Notifications (P2/P3)

```yaml
receivers:
  - name: slack
    slack_configs:
      - api_url: 'https://hooks.slack.com/services/...'
        channel: '#alerts-chat-backend'
        title: '{{ .GroupLabels.alertname }}'
        text: '{{ range .Alerts }}{{ .Annotations.description }}{{ end }}'
```

---

## 5. Dashboards

### Grafana Panels

**Overview Dashboard** (`chat-backend-overview`):

1. **Request Rate** (Graph)
   - Query: `sum(rate(http_requests_total[1m])) by (endpoint)`
   - Y-axis: Requests/sec

2. **Error Rate** (Graph)
   - Query: `sum(rate(http_requests_total{status=~"5.."}[1m])) / sum(rate(http_requests_total[1m]))`
   - Y-axis: Percentage

3. **Latency Heatmap** (Heatmap)
   - Query: `rate(http_request_duration_seconds_bucket[1m])`

4. **Active Connections** (Gauge)
   - Query: `websocket_connections_active`

5. **Database Query Duration** (Graph)
   - Query: `histogram_quantile(0.95, sum(rate(database_query_duration_seconds_bucket[1m])) by (le, table))`

---

### SLO Dashboard

**Service Level Objectives**:

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Availability** | 99.9% | `(total_requests - 5xx_errors) / total_requests` |
| **Latency (p95)** | <500ms | `histogram_quantile(0.95, http_request_duration_seconds)` |
| **Error Rate** | <0.1% | `5xx_errors / total_requests` |

---

## 6. Deployment Checklist

- [ ] Winston/Pino configured with JSON format
- [ ] PII redaction middleware enabled
- [ ] CloudWatch Logs agent running
- [ ] Prometheus metrics endpoint exposed at `/metrics`
- [ ] OpenTelemetry tracer initialized
- [ ] Jaeger collector configured
- [ ] Alert rules deployed to Prometheus
- [ ] PagerDuty integration tested (send test alert)
- [ ] Grafana dashboards imported
- [ ] Runbooks linked in alert annotations

---

**Version**: 1.0  
**Last Updated**: 2025-10-20  
**Next Review**: 2026-01-20
