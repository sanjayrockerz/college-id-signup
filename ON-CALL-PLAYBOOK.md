# On-Call Playbook

## Escalation Path
- L1: On-call Engineer → L2: Senior Engineer → L3: Architect

## Paging Thresholds
- P0: Service down, error rate >5%, data loss
- P1: Uptime <99.9%, p95 >500ms, error >1%
- P2: Minor degradation

## Response Times
- P0: Immediate, <15m ack, <1h MTTR
- P1: <30m ack, <4h MTTR
- P2: Next business day

## Communication
- Update status page, notify stakeholders, post-mortem within 48h
