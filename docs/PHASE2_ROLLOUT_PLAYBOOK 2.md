# Phase 2 Data Layer Rollout Playbook

**Version**: 1.0  
**Date**: October 22, 2025  
**Owner**: Release Manager  
**Approver**: Staff Test Engineer

---

## 🎯 Rollout Objectives

Deploy Phase 2 data layer improvements with zero user-visible disruption:

- **Indexes**: Composite + partial indexes for keyset pagination
- **PgBouncer**: Connection pooling with transaction mode
- **Redis Caching**: TTL-based caching with smart invalidation
- **Read Replicas**: Intelligent routing with circuit breaker

**Target SLOs**:

- Message history p95 ≤ 350ms @ 100+ req/s
- Message send p95 ≤ 250ms @ 100+ req/s
- Error rate < 1%
- Pool saturation < 80%

---

## 📋 Pre-Rollout Checklist

### Testing Validation

- [ ] All integration tests passing (14 tests)
- [ ] Load tests meet SLO targets at 5k-10k connections
- [ ] Chaos tests validate fallback paths
- [ ] Canary automation tested in staging

### Infrastructure Readiness

- [ ] PgBouncer configured and tested
- [ ] Redis cluster deployed with persistence
- [ ] Read replica provisioned with <5s lag
- [ ] Prometheus + Grafana dashboards deployed
- [ ] Alert rules configured in Prometheus
- [ ] On-call engineer identified

### Monitoring Baseline

- [ ] Capture 7-day baseline metrics:
  - Query latency percentiles (p50, p95, p99)
  - Pool saturation levels
  - Error rates per endpoint
  - Traffic patterns (hourly/daily)
- [ ] Document current system capacity limits
- [ ] Establish rollback time budget (15 minutes)

### Communication

- [ ] Rollout schedule communicated to stakeholders
- [ ] Incident response team on standby
- [ ] Customer support briefed on potential impacts
- [ ] Rollback runbook reviewed by ops team

---

## 🚀 Rollout Phases

### **Phase 1: Index Deployment**

**Duration**: 1-2 hours  
**Risk Level**: 🟢 Low  
**Rollback Strategy**: Index drop (instant)

#### Steps

1. **Deploy Indexes** (Off-Peak Hours Recommended)

   ```bash
   # Review migration
   cat migrations/02-keyset-pagination-indexes.sql

   # Apply to replica first (validation)
   psql $REPLICA_DATABASE_URL -f migrations/02-keyset-pagination-indexes.sql

   # Monitor replica for 15 minutes
   watch -n 5 'psql $REPLICA_DATABASE_URL -c "SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read FROM pg_stat_user_indexes WHERE schemaname = '\''public'\'' ORDER BY idx_scan DESC LIMIT 10"'

   # Apply to primary
   psql $DATABASE_URL -f migrations/02-keyset-pagination-indexes.sql
   ```

2. **Validate Index Usage**

   ```bash
   # Run integration tests
   npm run test:integration

   # Check EXPLAIN plans
   psql $DATABASE_URL -c "EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM \"Message\" WHERE \"conversationId\" = 'test' ORDER BY \"createdAt\" DESC, id DESC LIMIT 50"
   ```

3. **Monitor for 30 Minutes**
   - Index scan counts increasing
   - Sequential scans eliminated on target tables
   - No lock contention
   - Query latency stable or improved

#### Exit Criteria

✅ EXPLAIN plans show index usage  
✅ No sequential scans on `Message` or `Conversation`  
✅ p95 latency stable or decreased  
✅ No lock timeouts or deadlocks

#### Rollback Procedure

```sql
-- Drop indexes if causing issues
DROP INDEX CONCURRENTLY IF EXISTS idx_message_conversation_created;
DROP INDEX CONCURRENTLY IF EXISTS idx_message_unread;
DROP INDEX CONCURRENTLY IF EXISTS idx_conversation_participant;
DROP INDEX CONCURRENTLY IF EXISTS idx_conversation_updated;
```

---

### **Phase 2: PgBouncer Activation**

**Duration**: 2-3 hours  
**Risk Level**: 🟡 Medium  
**Rollback Strategy**: Revert connection string

#### Steps

1. **Configure PgBouncer**

   ```bash
   # Verify configuration
   cat config/pgbouncer.ini

   # Start PgBouncer
   docker-compose up -d pgbouncer

   # Verify connectivity
   psql "postgresql://user:pass@localhost:6432/dbname" -c "SHOW POOLS"
   ```

2. **Canary Traffic (10% for 15 minutes)**

   ```bash
   # Set feature flag
   curl -X PUT http://localhost:3000/api/admin/feature-flags/pgbouncer.enabled \
     -H "Content-Type: application/json" \
     -d '{"enabled": true, "rolloutPercent": 10}'

   # Monitor pool metrics
   watch -n 5 'psql "postgresql://user:pass@localhost:6432/pgbouncer" -c "SHOW POOLS"'
   ```

3. **Gradual Ramp**
   - 10% → 25% → 50% → 100%
   - 15-minute soak at each stage
   - Monitor: pool saturation, queue wait, error rate

4. **Full Activation**

   ```bash
   # Update DATABASE_URL in .env
   DATABASE_URL="postgresql://user:pass@localhost:6432/dbname?pool_timeout=30&statement_timeout=10000"

   # Restart application
   pm2 restart all
   ```

#### Exit Criteria

✅ Pool saturation < 80% under peak load  
✅ Queue wait < 10ms p95  
✅ No connection exhaustion errors  
✅ Transaction rollback rate unchanged  
✅ Query latency within 10% of baseline

#### Rollback Procedure

```bash
# Revert to direct Postgres connection
DATABASE_URL="postgresql://user:pass@postgres:5432/dbname"

# Restart application
pm2 restart all

# Stop PgBouncer
docker-compose stop pgbouncer
```

---

### **Phase 3: Redis Caching**

**Duration**: 3-4 hours  
**Risk Level**: 🟡 Medium  
**Rollback Strategy**: Feature flag disable

#### Steps

1. **Deploy Redis Cluster**

   ```bash
   # Start Redis with persistence
   docker-compose up -d redis

   # Verify replication
   redis-cli INFO replication

   # Test failover
   redis-cli DEBUG sleep 30  # Simulate master failure
   ```

2. **Per-Endpoint Canary Deployment**

   **a. Message History Caching**

   ```bash
   npm run canary:message-history
   ```

   - Stages: 10% → 25% → 50% → 100%
   - Duration: ~45 minutes
   - Auto-rollback on: error spike, latency degradation, cache failures

   **b. Conversation List Caching**

   ```bash
   npm run canary:conversation-list
   ```

   - Stages: 10% → 25% → 50% → 100%
   - Duration: ~45 minutes
   - Monitor: cache hit ratio (target >70% after warmup)

3. **Warmup Period**
   - Run load test to populate cache

   ```bash
   npm run test:load:history
   ```

   - Verify cache hit ratio increases to >70%

4. **Monitor Cache Performance**
   - Hit ratio: >70% after warmup
   - Latency improvement: 30-50% reduction
   - Invalidation speed: <100ms
   - Memory usage: <2GB under normal load

#### Exit Criteria

✅ Cache hit ratio >70% sustained  
✅ p95 latency improved by ≥30%  
✅ Invalidation timing <100ms  
✅ No stale data observed in manual testing  
✅ Cache failure triggers DB fallback correctly

#### Rollback Procedure

```bash
# Disable cache feature flags
curl -X PUT http://localhost:3000/api/admin/feature-flags/message.history.cache.enabled \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'

curl -X PUT http://localhost:3000/api/admin/feature-flags/conversation.list.cache.enabled \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'

# Flush cache (optional)
redis-cli FLUSHALL

# Verify DB handles load directly
npm run test:load:history
```

---

### **Phase 4: Read Replica Routing**

**Duration**: 4-5 hours  
**Risk Level**: 🔴 High  
**Rollback Strategy**: Feature flag disable

#### Steps

1. **Verify Replica Health**

   ```bash
   # Check replication lag
   psql $REPLICA_DATABASE_URL -c "SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))"

   # Should be <5 seconds
   ```

2. **Pilot with Low-Risk Endpoint**

   ```bash
   # Enable for message history (cached + replicated = low risk)
   curl -X PUT http://localhost:3000/api/admin/feature-flags/message.history.replica.enabled \
     -H "Content-Type: application/json" \
     -d '{"enabled": true, "rolloutPercent": 10}'
   ```

3. **Monitor Circuit Breaker**

   ```bash
   # Watch circuit breaker state
   curl http://localhost:3000/metrics | grep circuit_breaker_state

   # Should stay CLOSED (healthy)
   ```

4. **Gradual Ramp with Chaos Testing**
   - 10% → 25%: Monitor replica lag, verify fallback
   - 25% → 50%: Induce replica lag, verify primary fallback <30s
   - 50% → 100%: Sustained load, verify no drift

5. **Full Activation**
   ```bash
   # Enable for all read endpoints
   npm run canary:message-history
   npm run canary:conversation-list
   ```

#### Exit Criteria

✅ Replica lag <5s consistently  
✅ Circuit breaker transitions correctly  
✅ Primary fallback <30s on lag spike  
✅ No data consistency issues  
✅ p95 latency meets SLO  
✅ Load distributed: 70% replica, 30% primary

#### Rollback Procedure

```bash
# Disable replica routing
curl -X PUT http://localhost:3000/api/admin/feature-flags/message.history.replica.enabled \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'

curl -X PUT http://localhost:3000/api/admin/feature-flags/conversation.list.replica.enabled \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'

# Verify all traffic routed to primary
psql $DATABASE_URL -c "SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE '%replica%'"
# Should return 0
```

---

## 🚨 Rollback Triggers

### Automatic Rollback (Canary)

- **Queue Wait Spike**: >50% increase vs baseline
- **Error Rate Increase**: >20% increase vs baseline
- **Latency Degradation**: p95 exceeds SLO by >20%
- **Pool Saturation**: >85%
- **Circuit Breaker Open**: Replica unavailable

### Manual Rollback Decision Criteria

- User-reported data inconsistency
- Database deadlocks or lock timeouts
- Memory leak in cache layer
- Replication lag >30 seconds sustained
- On-call engineer judgment call

### Rollback Time Budget

- **Target**: Full rollback within 15 minutes
- **Phase 1 (Indexes)**: <5 minutes
- **Phase 2 (PgBouncer)**: <10 minutes
- **Phase 3 (Caching)**: Instant (feature flag)
- **Phase 4 (Replicas)**: Instant (feature flag)

---

## 📊 Monitoring During Rollout

### Key Dashboards

1. **Phase 2 Overview** - Grafana dashboard with:
   - Traffic split (canary %)
   - Latency percentiles (p50, p95, p99)
   - Error rate by endpoint
   - Pool saturation
   - Cache hit ratio
   - Replica lag

2. **Database Health** - PgBouncer, vacuum, bloat metrics

3. **Circuit Breaker State** - Real-time FSM transitions

### Alert Rules (Prometheus)

- `HighQueryLatency`: p95 >500ms for 5 minutes
- `PoolSaturationHigh`: >80% for 2 minutes
- `CacheDegradation`: Hit ratio <50% for 10 minutes
- `ReplicaLagHigh`: >10s for 5 minutes
- `ErrorRateSpike`: >2% for 2 minutes
- `CircuitBreakerOpen`: State OPEN for 1 minute

### Manual Checks (Every 30 Minutes)

```bash
# Check active connections
psql $DATABASE_URL -c "SELECT count(*), state FROM pg_stat_activity GROUP BY state"

# Check cache memory
redis-cli INFO memory

# Check replica lag
psql $REPLICA_DATABASE_URL -c "SELECT pg_last_xact_replay_timestamp()"

# Check error logs
tail -f /var/log/app/error.log | grep -i "error\|exception"
```

---

## 📞 Incident Response

### On-Call Contacts

- **Primary**: Release Manager (you)
- **Secondary**: Staff Test Engineer
- **Database Expert**: DBA Team Lead
- **Escalation**: VP Engineering

### Communication Channels

- **Slack**: `#phase2-rollout` (status updates)
- **PagerDuty**: Automatic escalation on critical alerts
- **Zoom**: War room link (on-demand)

### Incident Playbook

1. **Alert Received** → Acknowledge within 5 minutes
2. **Triage** → Check dashboards, determine severity
3. **Decide** → Continue monitoring OR rollback
4. **Execute** → Run rollback procedure for affected phase
5. **Verify** → Confirm metrics returned to baseline
6. **Communicate** → Update stakeholders on status
7. **Post-Mortem** → Document incident within 48 hours

---

## ✅ Post-Rollout Validation

### 24-Hour Monitoring

- [ ] All SLOs met consistently
- [ ] No error rate spikes
- [ ] Cache hit ratio stable >70%
- [ ] Replica lag <5s
- [ ] Pool saturation <80%
- [ ] No user-reported issues

### 7-Day Review

- [ ] Compare metrics: pre-rollout vs post-rollout
- [ ] Validate cost savings (reduced primary load)
- [ ] Review alert firing frequency
- [ ] Tune autovacuum settings based on new traffic patterns
- [ ] Document lessons learned

### Success Metrics

- ✅ **Performance**: p95 latency improved 30-50%
- ✅ **Scalability**: 2x connection capacity (5k → 10k)
- ✅ **Reliability**: 99.9% uptime maintained
- ✅ **Cost**: 40% reduction in primary DB load

---

## 📝 Rollout Log Template

```markdown
## Rollout Session: [Date]

**Phase**: [1/2/3/4]  
**Start Time**: [HH:MM UTC]  
**End Time**: [HH:MM UTC]  
**Executor**: [Name]

### Actions Taken

- [ ] Step 1: [Description]
- [ ] Step 2: [Description]
- [ ] Step 3: [Description]

### Metrics Captured

- Baseline: p95=[X]ms, errors=[Y]%, pool=[Z]%
- Post-Rollout: p95=[X]ms, errors=[Y]%, pool=[Z]%

### Incidents

- [None / Description of any issues]

### Outcome

- ✅ Success / ❌ Rollback / ⏸️ Paused

### Notes

- [Any observations or learnings]
```

---

## 🎓 Training & Runbooks

### Required Reading

- [ ] Phase 2 Architecture Overview
- [ ] Database Health Monitoring Status Doc
- [ ] PgBouncer Configuration Guide
- [ ] Circuit Breaker Design Doc

### Runbooks

- [Runbook: PgBouncer Connection Issues](./runbooks/pgbouncer-connection-issues.md)
- [Runbook: Cache Invalidation Failures](./runbooks/cache-invalidation-failures.md)
- [Runbook: Replica Lag Spike](./runbooks/replica-lag-spike.md)
- [Runbook: Circuit Breaker Stuck Open](./runbooks/circuit-breaker-stuck-open.md)

---

**End of Playbook**  
_Last Updated: October 22, 2025_
