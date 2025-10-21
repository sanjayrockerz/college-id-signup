# Incident Response Runbooks

**Version**: 1.0  
**Effective Date**: 2025-10-20  
**Authority**: SRE + Security Teams  
**On-Call Contact**: [PagerDuty Rotation]

---

## Overview

This document provides **step-by-step procedures** for responding to common production incidents in the chat backend. Each runbook includes:
- Detection criteria and alert triggers
- Immediate actions (first 5 minutes)
- Investigation steps
- Resolution procedures
- Post-incident follow-up

**Target Audience**: On-call engineers, SRE team, backend developers

---

## Incident Severity Levels

| Level | Description | Response Time | Escalation |
|-------|-------------|---------------|------------|
| **P0** | Critical outage (service down, data loss) | <5 min | Immediate: CTO + Incident Commander |
| **P1** | Major degradation (error rate >1%, high latency) | <15 min | On-call SRE + Backend Lead |
| **P2** | Minor issue (isolated failures, degraded performance) | <1 hour | On-call Backend Engineer |
| **P3** | Low priority (cosmetic, no customer impact) | Next business day | Backlog |

---

## Runbook Index

1. [Elevated Error Rates (>1% increase)](#runbook-1-elevated-error-rates)
2. [Connection Storms (>1000 concurrent connections)](#runbook-2-connection-storms)
3. [Database Saturation (query time >500ms p95)](#runbook-3-database-saturation)
4. [Cascading Failures (circuit breaker open)](#runbook-4-cascading-failures)
5. [Security Incident (unauthorized access)](#runbook-5-security-incident)
6. [Data Corruption (message loss/duplication)](#runbook-6-data-corruption)

---

## Runbook 1: Elevated Error Rates

### Alert Trigger
```
Alert: Error rate increased from 0.2% → 1.5% 
Severity: P1
Duration: 5+ minutes sustained
Affected: /api/v1/chat/conversations/:id/messages endpoint
```

### Symptoms
- Users reporting "Failed to send message" errors
- 5xx errors in application logs
- Spike in `http_requests_total{status="500"}` Prometheus metric

---

### Immediate Actions (First 5 Minutes)

**1. Acknowledge Alert**
```bash
# Acknowledge in PagerDuty
pagerduty ack incident-12345
```

**2. Check Service Health**
```bash
# Test health endpoint
curl https://chat-backend.internal/api/v1/health

# Expected: 200 OK
# If 5xx → service down, proceed to emergency escalation
```

**3. Check Recent Deployments**
```bash
# View last 5 deployments
kubectl rollout history deployment/chat-backend -n production | tail -5

# If deployed within last 30 minutes → likely cause
```

**Decision Point**:
- **If recent deployment (<30 min ago)**: Proceed to "Rollback Procedure"
- **If no recent deployment**: Proceed to "Investigation Steps"

---

### Rollback Procedure (If Recent Deployment)

```bash
# 1. Rollback to previous version
kubectl rollout undo deployment/chat-backend -n production

# 2. Verify rollback success
kubectl rollout status deployment/chat-backend -n production
# Wait for: "deployment 'chat-backend' successfully rolled out"

# 3. Check error rate decreased
# Open Grafana dashboard: https://grafana.company.com/d/chat-backend
# Verify: Error rate drops back to <0.5% within 2 minutes

# 4. Notify team in #incidents Slack channel
slack post "#incidents" "Rolled back chat-backend deployment due to error rate spike. Investigating root cause."
```

**Expected Outcome**: Error rate returns to baseline within 5 minutes

**If Rollback Fails**: Escalate to P0, engage Incident Commander

---

### Investigation Steps (If Not Deployment-Related)

**1. Check Error Logs**
```bash
# View last 100 errors in CloudWatch
aws logs tail /aws/ecs/chat-backend --follow --filter-pattern "ERROR" --since 5m | head -100

# Look for patterns:
# - "Connection to database failed" → Database issue (see Runbook 3)
# - "Rate limit exceeded" → Legitimate traffic spike or DDoS (see Runbook 2)
# - "Validation failed" → Client sending malformed requests (not our issue)
# - "Unknown error" → Application bug (proceed to code investigation)
```

**2. Check Database Status**
```bash
# Query database health
curl https://chat-backend.internal/api/v1/health/database

# Check connection pool
psql -h db.internal -U chatuser -d chatdb -c "SELECT count(*) FROM pg_stat_activity;"

# If >80% of max connections → Database saturation (see Runbook 3)
```

**3. Check Dependencies**
```bash
# Test S3 connectivity (for attachments)
aws s3 ls s3://chat-attachments/

# Test Redis (if used for caching)
redis-cli -h cache.internal PING
# Expected: PONG
```

**4. Review Metrics Dashboard**
- Open Grafana: https://grafana.company.com/d/chat-backend
- Check:
  - Request rate (sudden spike?)
  - Latency (p50/p95/p99 increased?)
  - Database query time (slow queries?)
  - Memory usage (OOM kills?)

---

### Resolution Procedures

#### Scenario A: Database Connection Pool Exhausted

**Symptoms**: Error logs show `ECONNREFUSED` or `too many clients already`

**Fix**:
```bash
# 1. Increase connection pool size (temporary)
kubectl set env deployment/chat-backend DATABASE_POOL_MAX=50 -n production
# Wait 2 minutes for pods to restart

# 2. Verify error rate decreases
# Check Grafana dashboard

# 3. File ticket to investigate connection leak
jira create "Investigate connection pool leak - increased max from 20 to 50"
```

**Long-term Fix**: Code review to find connection leaks, add query timeout

---

#### Scenario B: Unhandled Exception in Code

**Symptoms**: Stack traces in logs for specific endpoint

**Fix**:
```bash
# 1. Identify error pattern
# Example: "Cannot read property 'id' of undefined" in sendMessage handler

# 2. Apply hotfix (add null check)
# Deploy emergency patch (bypass normal approval for P1)
git checkout -b hotfix/null-check-message
# ... make fix ...
git commit -m "Hotfix: Add null check in sendMessage"
git push origin hotfix/null-check-message

# 3. Deploy via CI/CD
# Approve production deployment in GitHub Actions

# 4. Monitor for 30 minutes
# Verify error rate drops to <0.5%
```

**Follow-up**: Post-mortem within 24 hours, add test coverage

---

#### Scenario C: External Dependency Failure (S3, Redis)

**Symptoms**: Errors like `S3 connection timeout`, `Redis ECONNREFUSED`

**Fix**:
```bash
# 1. Check AWS Service Health Dashboard
# https://status.aws.amazon.com/

# If AWS region issue → failover to backup region (if configured)
# If Redis issue → disable caching temporarily

# 2. Disable feature flag for attachment uploads (if S3 down)
curl -X POST https://feature-flags.internal/api/flags/attachment-uploads/disable \
  -H "Authorization: Bearer ${FF_API_KEY}"

# 3. Notify users via status page
statuspage update "Temporary issue with file uploads. Working on fix."
```

---

### Post-Incident Actions

**Within 1 Hour**:
- [ ] Post incident summary in #incidents Slack
- [ ] Update status page if customer-facing
- [ ] File Jira ticket for root cause investigation

**Within 24 Hours**:
- [ ] Complete post-mortem document (template in `/docs/postmortems/`)
- [ ] Identify action items (code fixes, monitoring improvements)
- [ ] Assign owners and due dates

**Within 1 Week**:
- [ ] Implement preventive measures
- [ ] Update runbook based on learnings

---

## Runbook 2: Connection Storms

### Alert Trigger
```
Alert: Active WebSocket connections > 1000 (spike from 200 baseline)
Severity: P1
Duration: 5+ minutes sustained
Metrics: websocket_connections_active gauge
```

### Symptoms
- Socket.IO connection count spiking
- Memory usage increasing (each connection consumes ~2 MB)
- New connection requests timing out
- Existing connections dropping

---

### Immediate Actions (First 5 Minutes)

**1. Verify Legitimate Traffic vs Attack**
```bash
# Check connection sources
kubectl exec -it deployment/chat-backend -n production -- \
  netstat -an | grep :3001 | awk '{print $5}' | cut -d: -f1 | sort | uniq -c | sort -nr | head -20

# Look for patterns:
# - Many connections from single IP → DDoS attack
# - Connections from legitimate user IP ranges → Traffic spike
```

**2. Check Application Metrics**
```bash
# View connection stats
curl https://chat-backend.internal/metrics | grep websocket_connections

# websocket_connections_active 1200  ← Current count
# websocket_connections_total 15000  ← Total since startup
# websocket_disconnections_total 13800  ← Normal churn
```

**3. Decision Point**:
- **If attack (many from few IPs)**: Proceed to "DDoS Mitigation"
- **If legitimate spike**: Proceed to "Scaling Procedure"

---

### DDoS Mitigation (If Attack Detected)

**1. Block Attacking IPs**
```bash
# Add IPs to WAF blocklist
aws wafv2 update-ip-set \
  --name chat-backend-blocklist \
  --id abc123 \
  --addresses "192.0.2.1/32" "198.51.100.0/24"

# Apply rate limit at firewall
# Allow max 5 connections per IP
```

**2. Enable Aggressive Rate Limiting**
```bash
# Update rate limit (via feature flag or config)
kubectl set env deployment/chat-backend \
  WEBSOCKET_RATE_LIMIT=1 \
  WEBSOCKET_MAX_CONNECTIONS_PER_IP=3 \
  -n production
```

**3. Notify Security Team**
```bash
slack post "#security" "@security-oncall DDoS attack detected on chat backend. Blocked IPs: 192.0.2.1/32. Monitoring."
```

---

### Scaling Procedure (If Legitimate Traffic)

**1. Horizontal Auto-Scaling**
```bash
# Manually scale up replicas (if HPA not fast enough)
kubectl scale deployment/chat-backend --replicas=10 -n production

# Verify pods starting
kubectl get pods -n production -w
```

**2. Increase Resource Limits**
```bash
# If hitting memory limits, increase allocation
kubectl set resources deployment/chat-backend \
  --limits=memory=4Gi \
  --requests=memory=2Gi \
  -n production
```

**3. Monitor Connection Distribution**
```bash
# Verify load balancer distributing evenly
kubectl get pods -n production -o wide
# Check connections per pod (should be ~equal)
```

---

### Investigation (Post-Mitigation)

**1. Identify Traffic Source**
```bash
# Check application logs for user activity patterns
aws logs insights query \
  --log-group-name /aws/ecs/chat-backend \
  --start-time $(date -u -d '1 hour ago' +%s) \
  --query-string 'fields @timestamp, userId | stats count() by userId | sort count desc | limit 20'

# If top user has 100x more connections than others → investigate
```

**2. Check for Client Bug**
```bash
# Review User-Agent headers
# Malformed client may reconnect in infinite loop

grep "connection" /var/log/chat-backend.log | \
  awk '{print $10}' | sort | uniq -c | sort -nr | head -10

# Example output:
# 500 "MobileApp/1.2.3" ← Normal
# 5000 "MobileApp/1.0.0" ← Buggy old version?
```

**Action**: If buggy client detected, notify frontend team to force upgrade

---

### Post-Incident Actions

- [ ] Review auto-scaling policies (were they too slow?)
- [ ] Update connection limits based on observed capacity
- [ ] Improve anomaly detection (alert earlier)
- [ ] Document traffic pattern for future capacity planning

---

## Runbook 3: Database Saturation

### Alert Trigger
```
Alert: Database query p95 latency > 500ms (baseline: 50ms)
Severity: P1
Duration: 5+ minutes sustained
Metrics: database_query_duration_seconds{quantile="0.95"}
```

### Symptoms
- API responses slow (timeout errors)
- Database CPU at 100%
- Connection pool exhausted
- Slow query logs filling up

---

### Immediate Actions (First 5 Minutes)

**1. Identify Slow Queries**
```bash
# Connect to database
psql -h db.internal -U chatuser -d chatdb

# Find long-running queries
SELECT pid, now() - query_start as duration, query 
FROM pg_stat_activity 
WHERE state = 'active' 
ORDER BY duration DESC 
LIMIT 10;

# Look for queries running >5 seconds
```

**2. Kill Long-Running Queries (If Safe)**
```sql
-- If query is SELECT (read-only), safe to kill
SELECT pg_terminate_backend(12345);  -- Replace with actual PID

-- If UPDATE/DELETE, consult DBA before killing
```

**3. Check Database Metrics**
```bash
# CPU usage
SELECT * FROM pg_stat_database WHERE datname = 'chatdb';

# Lock contention
SELECT * FROM pg_locks WHERE NOT granted;

# Cache hit ratio (should be >99%)
SELECT 
  sum(blks_hit) / (sum(blks_hit) + sum(blks_read)) AS cache_hit_ratio
FROM pg_stat_database;
```

---

### Resolution Procedures

#### Scenario A: Missing Index

**Symptoms**: Full table scans in slow query log

**Example**:
```sql
-- Slow query (no index on userId)
SELECT * FROM messages WHERE user_id = 'user-123' ORDER BY created_at DESC;
-- Execution time: 5000ms (full scan of 10M rows)
```

**Fix**:
```sql
-- Create index (in transaction to avoid locking)
BEGIN;
CREATE INDEX CONCURRENTLY idx_messages_user_id_created_at 
  ON messages(user_id, created_at DESC);
COMMIT;

-- Verify query now fast
EXPLAIN ANALYZE 
SELECT * FROM messages WHERE user_id = 'user-123' ORDER BY created_at DESC;
-- Expected: Index scan, <50ms
```

---

#### Scenario B: Lock Contention

**Symptoms**: Many queries waiting for locks

**Fix**:
```sql
-- Find blocking queries
SELECT 
  blocked_locks.pid AS blocked_pid,
  blocking_locks.pid AS blocking_pid,
  blocked_activity.query AS blocked_query,
  blocking_activity.query AS blocking_query
FROM pg_locks blocked_locks
JOIN pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
JOIN pg_locks blocking_locks ON blocking_locks.locktype = blocked_locks.locktype
JOIN pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;

-- Kill blocking query (with DBA approval)
SELECT pg_terminate_backend(blocking_pid);
```

---

#### Scenario C: Connection Pool Exhaustion

**Symptoms**: "Too many clients already" errors

**Fix**:
```bash
# 1. Increase max connections (temporary)
# In RDS parameter group
aws rds modify-db-parameter-group \
  --db-parameter-group-name chatdb-params \
  --parameters "ParameterName=max_connections,ParameterValue=200,ApplyMethod=immediate"

# 2. Restart application to refresh pool
kubectl rollout restart deployment/chat-backend -n production

# 3. Investigate connection leaks
# Check for queries holding connections open
SELECT count(*), state FROM pg_stat_activity GROUP BY state;
```

---

#### Scenario D: Runaway Query

**Symptoms**: Single query consuming 100% CPU

**Fix**:
```sql
-- Find CPU-intensive query
SELECT pid, query, state, now() - query_start as duration
FROM pg_stat_activity
WHERE state != 'idle'
ORDER BY query_start ASC;

-- Kill runaway query
SELECT pg_terminate_backend(pid);

-- Add query timeout to prevent recurrence
ALTER DATABASE chatdb SET statement_timeout = '30s';
```

---

### Escalation to DBA

**When to Escalate**:
- Database CPU >90% for >10 minutes despite fixes
- Data corruption suspected
- Replication lag >1 minute
- Disk usage >85%

**DBA Actions**:
- Promote read replica to primary (failover)
- Restore from backup (if corruption)
- Resize database instance (vertical scaling)

---

### Post-Incident Actions

- [ ] Add missing indexes identified
- [ ] Optimize slow queries (refactor if needed)
- [ ] Review connection pool settings
- [ ] Set up query performance monitoring (pg_stat_statements)
- [ ] Update database capacity plan

---

## Runbook 4: Cascading Failures

### Alert Trigger
```
Alert: Circuit breaker OPEN for database connection
Severity: P0
Impact: All API requests failing (500 errors)
```

### Symptoms
- All endpoints returning 503 "Service Unavailable"
- Circuit breaker tripped due to consecutive failures
- Database unreachable or overloaded

---

### Immediate Actions (First 5 Minutes)

**1. Verify Circuit Breaker Status**
```bash
# Check application logs
kubectl logs deployment/chat-backend -n production | grep "Circuit breaker"

# Example output:
# "Circuit breaker OPEN: database connection failed 10 consecutive times"
```

**2. Test Database Connectivity**
```bash
# From backend pod
kubectl exec -it deployment/chat-backend -n production -- \
  psql -h db.internal -U chatuser -d chatdb -c "SELECT 1;"

# If connection fails → database down (proceed to Database Recovery)
# If connection succeeds → circuit breaker stuck (proceed to Reset Circuit Breaker)
```

---

### Database Recovery (If Database Down)

**1. Check RDS Status**
```bash
aws rds describe-db-instances \
  --db-instance-identifier chatdb-prod \
  --query 'DBInstances[0].DBInstanceStatus'

# Possible statuses:
# - "available" → Database should be up (connection issue)
# - "rebooting" → Wait for reboot to complete
# - "failed" → Critical, engage DBA immediately
```

**2. Failover to Read Replica (If Primary Down)**
```bash
# Promote read replica to primary
aws rds promote-read-replica \
  --db-instance-identifier chatdb-prod-replica-1

# Update backend to point to new primary
kubectl set env deployment/chat-backend \
  DATABASE_URL="postgresql://chatuser:pass@chatdb-replica-1.internal:5432/chatdb" \
  -n production
```

**3. Monitor Recovery**
```bash
# Wait for circuit breaker to close automatically
# (usually 60 seconds after first successful request)

# Or manually reset circuit breaker
curl -X POST https://chat-backend.internal/admin/circuit-breaker/reset \
  -H "Authorization: Bearer ${ADMIN_TOKEN}"
```

---

### Reset Circuit Breaker (If False Alarm)

**Scenario**: Database is healthy but circuit breaker stuck open due to transient issue

**Fix**:
```bash
# Restart pods to reset circuit breaker state
kubectl rollout restart deployment/chat-backend -n production

# Verify pods healthy
kubectl get pods -n production
# All pods should be "Running" with READY 1/1
```

---

### Post-Incident Actions

- [ ] Review circuit breaker thresholds (too sensitive?)
- [ ] Improve health checks (distinguish transient vs permanent failures)
- [ ] Set up database monitoring (CloudWatch alarms for RDS)
- [ ] Test failover procedure in staging environment

---

## Runbook 5: Security Incident

### Alert Trigger
```
Alert: CRITICAL vulnerability detected in dependency (CVSS > 9.0)
OR
Alert: Unauthorized access attempt detected (10+ failed auth within 1 min)
```

### Immediate Actions (First 5 Minutes)

**1. Declare Security Incident**
```bash
# Page security team
pagerduty trigger incident --title "Security incident: unauthorized access attempts" --service "chat-backend"

# Start war room in Slack
slack create-channel "#incident-security-$(date +%Y%m%d)"
```

**2. Assess Blast Radius**
```bash
# Check access logs
aws logs tail /aws/ecs/chat-backend --follow --filter-pattern "401" --since 15m

# Count failed auth attempts by IP
grep "401" /var/log/chat-backend.log | awk '{print $3}' | sort | uniq -c | sort -nr
```

**3. Immediate Containment**
```bash
# Block attacking IPs (if applicable)
aws wafv2 update-ip-set --name blocklist --addresses "192.0.2.1/32"

# Disable affected endpoint (if zero-day exploit)
kubectl set env deployment/chat-backend FEATURE_FLAG_ENDPOINT_X=disabled -n production
```

---

### Vulnerability Remediation

**1. Apply Security Patch**
```bash
# Update vulnerable dependency
npm update vulnerable-package@latest

# Run security audit
npm audit fix --force

# Test application
npm test

# Deploy emergency fix (bypass normal approval)
git commit -m "Security patch: update vulnerable-package to 2.3.4"
git push origin main
```

**2. Rotate Credentials (If Compromised)**
```bash
# Rotate database password
aws secretsmanager rotate-secret --secret-id chatdb-credentials

# Rotate API keys
# ... depends on what was compromised
```

---

### Post-Incident Actions

- [ ] Complete security incident report
- [ ] Notify affected users (if data breach)
- [ ] File vulnerability disclosure (if applicable)
- [ ] Update threat model
- [ ] Improve detection mechanisms

---

## Runbook 6: Data Corruption

### Alert Trigger
```
Alert: Message count mismatch detected (database vs app state)
OR
User Report: "My messages are duplicated/missing"
```

### Immediate Actions (First 5 Minutes)

**1. Stop the Bleed**
```bash
# Disable writes to affected resource
kubectl set env deployment/chat-backend FEATURE_FLAG_MESSAGE_WRITE=disabled -n production

# This prevents further corruption while investigating
```

**2. Assess Damage**
```sql
-- Check for duplicate messages
SELECT message_id, COUNT(*) 
FROM messages 
GROUP BY message_id 
HAVING COUNT(*) > 1;

-- Check for orphaned messages (conversation doesn't exist)
SELECT m.message_id 
FROM messages m 
LEFT JOIN conversations c ON m.conversation_id = c.id 
WHERE c.id IS NULL;
```

**3. Notify Stakeholders**
```bash
slack post "#incidents" "@channel Data corruption detected in messages table. Write operations disabled. Investigating."
```

---

### Recovery Procedures

#### Scenario A: Duplicate Messages

**Fix**:
```sql
-- Delete duplicates, keeping oldest
DELETE FROM messages
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY message_id ORDER BY created_at ASC) AS rn
    FROM messages
  ) t
  WHERE t.rn > 1
);
```

#### Scenario B: Missing Messages

**Fix**:
```bash
# Restore from most recent backup
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier chatdb-prod \
  --target-db-instance-identifier chatdb-restore-$(date +%Y%m%d) \
  --restore-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ)

# Compare restored data with current
# Identify missing rows and insert
```

---

### Post-Incident Actions

- [ ] Root cause analysis (code bug? migration issue?)
- [ ] Add data integrity checks (automated daily job)
- [ ] Improve backup/restore procedures
- [ ] Add database constraints to prevent corruption

---

## Emergency Contacts

| Role | Contact | Phone | Availability |
|------|---------|-------|--------------|
| On-Call SRE | [PagerDuty] | +1-xxx | 24/7 |
| Backend Lead | [Name] | +1-xxx | 24/7 |
| DBA Lead | [Name] | +1-xxx | 24/7 |
| Security Lead | [Name] | +1-xxx | On-call |
| Incident Commander | [Name] | +1-xxx | Business hours |

---

## Post-Mortem Template

After every P0/P1 incident, complete a post-mortem using `/docs/postmortems/TEMPLATE.md`:

```markdown
# Post-Mortem: [Incident Title]

**Date**: YYYY-MM-DD
**Severity**: P0/P1
**Duration**: X hours
**Impact**: X users affected, X% error rate

## Timeline
- HH:MM - Alert triggered
- HH:MM - On-call acknowledged
- HH:MM - Root cause identified
- HH:MM - Fix deployed
- HH:MM - Service restored

## Root Cause
[Detailed explanation]

## Resolution
[What fixed it]

## Action Items
- [ ] [Preventive measure] - Owner: [Name] - Due: [Date]
- [ ] [Monitoring improvement] - Owner: [Name] - Due: [Date]

## Lessons Learned
[What went well, what didn't]
```

---

**Version**: 1.0  
**Last Updated**: 2025-10-20  
**Next Review**: 2026-01-20
