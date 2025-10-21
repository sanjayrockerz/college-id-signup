# RUNBOOK-003: DB Saturation (p95 > 500ms)

## Symptoms
- Latency spikes; DB CPU >90%

## Diagnosis
- Check pg_stat_statements for slow queries
- Look for missing indexes and lock contention

## Remediation
- Add indexes, optimize queries
- Scale DB vertically/horizontally

## Escalation
- Engage DBA if unresolved after remediation
