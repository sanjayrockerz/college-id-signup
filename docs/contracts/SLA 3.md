# Service Level Agreement (v2.0.0)

- Uptime: 99.9% (<= 43 min downtime/month)
- Latency: p95 < 250ms (send), p99 < 500ms (history)
- Throughput: 1000 messages/sec sustained
- Error Budget: 0.1% of requests per month
- Support: 24/7 on-call, MTTR < 1h for P0

## SLOs & Error Budget

- Violations burn the error budget; slow down releases if budget < 50%.

## Measurement

- Prometheus metrics: latency histograms, error rates, connection counts.
- Dashboards: Grafana overview.json.

## Incident Response

- P0: Health down, error rate >5%, data loss. Immediate response, <1h MTTR.
- P1: Uptime <99.9%, p95 >500ms, error >1%. <4h MTTR.
- P2: Minor degradation. Next business day.
