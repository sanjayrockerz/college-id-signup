# RUNBOOK-001: Elevated Error Rate (>1%)

## Symptoms
- Dashboard alert, error_rate_total spike

## Diagnosis
- Check logs for stack traces
- Query DB health: SELECT pid, state, wait_event, query FROM pg_stat_activity;
- Inspect rate limiting (429s)

## Remediation
- Scale instances if CPU >80%
- Restart service if memory leak suspected
- Rollback deployment if regression

## Escalation
- Page on-call if >5% error rate or unresolved in 15 minutes
