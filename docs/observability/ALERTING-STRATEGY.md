# Alerting Strategy

**Version**: 1.0  
**Effective Date**: 2025-10-20  
**Authority**: SRE Team

---

## Alert Severity Matrix

| Severity | Response Time | Notification Channel | Escalation | Example |
|----------|---------------|----------------------|------------|---------|
| **P0** | <5 min | PagerDuty (immediate) | CTO + Incident Commander | Service down, data loss |
| **P1** | <15 min | PagerDuty (urgent) | On-call SRE | Error rate >1%, high latency |
| **P2** | <1 hour | Slack `#alerts` | On-call Backend Eng | Degraded performance |
| **P3** | Next business day | Slack `#alerts` | Backlog | Low priority warning |

---

## SLO-Based Alerts

### 1. Availability SLO

**Target**: 99.9% uptime (43 minutes downtime/month)

**Error Budget**: 0.1% of requests can fail

**Alert**:
```yaml
- alert: ErrorBudgetExhausted
  expr: |
    (
      1 - (
        sum(rate(http_requests_total{status!~"5.."}[30d]))
        /
        sum(rate(http_requests_total[30d]))
      )
    ) > 0.001
  labels:
    severity: P1
  annotations:
    summary: "Monthly error budget exhausted"
    description: "Current availability: {{ $value | humanizePercentage }}"
```

---

### 2. Latency SLO

**Target**: 95th percentile <500ms

**Alert**:
```yaml
- alert: LatencySLOViolation
  expr: |
    histogram_quantile(0.95,
      sum(rate(http_request_duration_seconds_bucket[5m])) by (le)
    ) > 0.5
  for: 10m
  labels:
    severity: P2
  annotations:
    summary: "p95 latency exceeds 500ms"
```

---

## Alert Tuning

### Avoid False Positives

**Use `for` clause**:
```yaml
# Bad: Alerts on single data point
expr: error_rate > 0.01

# Good: Alerts only after 5 minutes sustained
expr: error_rate > 0.01
for: 5m
```

**Multi-window burn rate** (SRE best practice):
```yaml
# Alert if error budget burns 10x faster than acceptable
- alert: FastErrorBudgetBurn
  expr: |
    (
      sum(rate(http_requests_total{status=~"5.."}[1h])) / sum(rate(http_requests_total[1h]))
      > 10 * 0.001  # 10x the allowed error rate
    )
    AND
    (
      sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))
      > 10 * 0.001
    )
  labels:
    severity: P0
```

---

### Reduce Alert Fatigue

**Silence non-actionable alerts**:
```yaml
# Don't alert on expected maintenance windows
- alert: HighErrorRate
  expr: error_rate > 0.01
  for: 5m
  # Silence during known deployment windows
  inhibit_rules:
    - target_match:
        alertname: HighErrorRate
      source_match:
        alertname: MaintenanceWindow
```

**Group related alerts**:
```yaml
# Group all database alerts together
route:
  group_by: ['alertname', 'database']
  group_wait: 30s
  group_interval: 5m
```

---

## On-Call Rotation

**Schedule**: 1-week shifts, 24/7 coverage

**PagerDuty Schedule**:
- Primary on-call: SRE team
- Secondary escalation: Backend team lead
- Final escalation: CTO (P0 only)

**Handoff Procedure**:
1. Outgoing on-call posts summary in `#oncall` Slack
2. Incoming on-call acknowledges
3. Active incidents transferred in PagerDuty

---

## Testing Alerts

**Monthly alert fire drill**:
```bash
# Trigger test alert
curl -X POST https://prometheus.internal/api/v1/alerts \
  -d 'alert=TestAlert&severity=P2&description=Monthly fire drill'

# Verify:
# 1. PagerDuty incident created
# 2. Slack notification sent
# 3. Runbook link accessible
```

---

**Version**: 1.0  
**Last Updated**: 2025-10-20  
**Next Review**: 2026-04-20
