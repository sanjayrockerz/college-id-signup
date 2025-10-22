# WebSocket Infrastructure Operations Runbook

**Purpose**: Operational guide for managing WebSocket infrastructure, graceful shutdowns, connection draining, and failover scenarios.  
**Audience**: DevOps, SRE, Infrastructure Engineers  
**Last Updated**: 2025-10-22

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Normal Operations](#normal-operations)
3. [Deployment Procedures](#deployment-procedures)
4. [Graceful Shutdown Sequence](#graceful-shutdown-sequence)
5. [Scaling Operations](#scaling-operations)
6. [Failover Scenarios](#failover-scenarios)
7. [Incident Response](#incident-response)
8. [Health Check Reference](#health-check-reference)
9. [Troubleshooting Guide](#troubleshooting-guide)

---

## Architecture Overview

### Component Stack

```
┌─────────────────────────────────────────────────────────────────┐
│                        Internet / CDN                            │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Load Balancer (ALB / NGINX)                    │
│  - WebSocket Upgrade Support                                     │
│  - Session Affinity (Cookie-based, 24h TTL)                     │
│  - Idle Timeout: 80s (heartbeat + grace + margin)               │
│  - Health Checks: /health every 15s                             │
└────────────────────────────┬────────────────────────────────────┘
                             │
                    ┌────────┴────────┐
                    │                 │
                    ▼                 ▼
┌──────────────────────┐   ┌──────────────────────┐
│  Backend Pod 1       │   │  Backend Pod 2       │   (Replicas: 3-10)
│  - Node.js (NestJS)  │   │  - Node.js (NestJS)  │
│  - Socket.IO Server  │   │  - Socket.IO Server  │
│  - Port 3001         │   │  - Port 3001         │
│  - Heartbeat: 25s    │   │  - Heartbeat: 25s    │
└──────────┬───────────┘   └──────────┬───────────┘
           │                          │
           └────────┬─────────────────┘
                    │
           ┌────────┴────────┐
           │                 │
           ▼                 ▼
┌─────────────────┐   ┌─────────────────┐
│  PostgreSQL     │   │  Redis (Presence│
│  (Primary)      │   │   + Adapter)    │
└─────────────────┘   └─────────────────┘
```

### Connection Lifecycle

```
1. Client Connect
   ├─▶ HTTP Upgrade Request (Socket.IO handshake)
   ├─▶ LB Routes to Pod (cookie affinity assigned)
   ├─▶ JWT Verification (if auth enabled)
   ├─▶ WebSocket Established
   └─▶ Presence Registered in Redis

2. Active Connection
   ├─▶ Heartbeat Ping every 25s (Server → Client)
   ├─▶ Heartbeat Pong expected within 50s (25s + 25s grace)
   ├─▶ Presence Extended in Redis every 25s
   └─▶ Messages Flow Bidirectionally

3. Graceful Disconnect
   ├─▶ Client sends close frame OR
   ├─▶ Server initiates shutdown (SIGTERM)
   ├─▶ 'server_shutdown' event emitted to clients
   ├─▶ Connections drain (30s window)
   ├─▶ Presence Cleaned Up
   └─▶ Socket Closed
```

---

## Normal Operations

### Monitoring Dashboards

**Key Metrics to Watch**:

| Metric | Normal Range | Warning Threshold | Critical Threshold |
|--------|--------------|-------------------|-------------------|
| Active Connections | Varies | N/A | >5000 per pod |
| Connection Churn | <1% per min | 5% per min | 10% per min |
| Heartbeat Timeouts | <0.5% | 2% | 5% |
| Transport Closes | <0.1% | 1% | 3% |
| Health Check Success | >99.9% | <99% | <95% |
| CPU per Pod | <70% | 80% | 90% |
| Memory per Pod | <80% | 85% | 90% |
| Database Connections | <40/pod | 45/pod | 48/pod |

### Daily Health Checks

```bash
#!/bin/bash
# daily-health-check.sh

NAMESPACE="chat-backend-prod"

echo "=== Daily WebSocket Infrastructure Health Check ==="
echo "Date: $(date)"
echo

# 1. Pod health
echo "## Pod Status"
kubectl get pods -n $NAMESPACE -l app=chat-backend -o wide

# 2. HPA status
echo -e "\n## HPA Status"
kubectl get hpa -n $NAMESPACE

# 3. Recent errors
echo -e "\n## Recent Errors (last hour)"
kubectl logs -n $NAMESPACE -l app=chat-backend --since=1h | grep -i error | wc -l

# 4. Connection metrics
echo -e "\n## Connection Metrics"
curl -s http://localhost:3001/metrics | grep ws_connections

# 5. Health endpoint
echo -e "\n## Health Endpoint Status"
kubectl exec -n $NAMESPACE deployment/chat-backend -- \
  curl -s http://localhost:3001/health | jq '.database.overall'

echo -e "\n=== Health Check Complete ==="
```

---

## Deployment Procedures

### Pre-Deployment Checklist

- [ ] Review changes in staging environment
- [ ] Verify database migrations applied (if any)
- [ ] Check current active connections: `kubectl top pods`
- [ ] Verify HPA is enabled: `kubectl get hpa`
- [ ] Check PodDisruptionBudget: `kubectl get pdb`
- [ ] Announce maintenance window (if major changes)
- [ ] Backup current image tag for rollback

### Zero-Downtime Deployment

```bash
#!/bin/bash
# zero-downtime-deploy.sh

NAMESPACE="chat-backend-prod"
NEW_IMAGE="your-registry/chat-backend:v1.2.3"

echo "=== Zero-Downtime Deployment ==="
echo "New Image: $NEW_IMAGE"
echo

# 1. Update deployment image
kubectl set image deployment/chat-backend \
  chat-backend=$NEW_IMAGE \
  -n $NAMESPACE

# 2. Watch rollout status
kubectl rollout status deployment/chat-backend -n $NAMESPACE

# 3. Monitor connection churn during rollout
echo -e "\n=== Monitoring Connection Churn ==="
for i in {1..30}; do
  DISCONNECTS=$(kubectl logs -n $NAMESPACE -l app=chat-backend --tail=100 | grep -c "disconnect")
  echo "$(date +%T) - Disconnects in last 100 logs: $DISCONNECTS"
  sleep 2
done

# 4. Verify new pods healthy
echo -e "\n=== New Pod Status ==="
kubectl get pods -n $NAMESPACE -l app=chat-backend -o wide

# 5. Check health
echo -e "\n=== Health Check ==="
kubectl exec -n $NAMESPACE deployment/chat-backend -- \
  curl -s http://localhost:3001/health

echo -e "\n=== Deployment Complete ==="
```

### Rollback Procedure

```bash
#!/bin/bash
# rollback.sh

NAMESPACE="chat-backend-prod"

echo "=== Rolling Back Deployment ==="

# Check rollout history
kubectl rollout history deployment/chat-backend -n $NAMESPACE

# Rollback to previous version
kubectl rollout undo deployment/chat-backend -n $NAMESPACE

# Watch rollback progress
kubectl rollout status deployment/chat-backend -n $NAMESPACE

# Verify health
kubectl exec -n $NAMESPACE deployment/chat-backend -- \
  curl -s http://localhost:3001/health

echo "=== Rollback Complete ==="
```

---

## Graceful Shutdown Sequence

### Timeline Breakdown

```
T+0s   │ SIGTERM received by pod
       │
T+2s   │ /tmp/shutdown-initiated file created
       │ Readiness probe begins failing
       │
T+5s   │ Readiness probe fails (1st failure)
       │
T+10s  │ Readiness probe fails (2nd failure)
       │ Pod marked Unready → LB stops routing
       │
T+12s  │ SIGTERM sent to Node.js process (PID 1)
       │ app.close() called → HTTP server stops accepting
       │ Socket.IO server emits 'server_shutdown' to clients
       │
T+15s  │ Clients receive 'server_shutdown', begin graceful disconnect
       │
T+30s  │ Active connections drained (30s drain window)
       │
T+42s  │ Process exits gracefully (exit code 0)
       │
T+45s  │ If process still alive, Kubernetes sends SIGKILL
       │ Pod terminated forcefully
```

### Manual Graceful Shutdown Test

```bash
#!/bin/bash
# test-graceful-shutdown.sh

NAMESPACE="chat-backend-prod"
POD=$(kubectl get pod -n $NAMESPACE -l app=chat-backend -o jsonpath='{.items[0].metadata.name}')

echo "=== Testing Graceful Shutdown on $POD ==="

# 1. Check current connections
echo "Current connections:"
kubectl exec -n $NAMESPACE $POD -- \
  curl -s http://localhost:3001/metrics | grep ws_connections

# 2. Send SIGTERM
echo -e "\nSending SIGTERM..."
kubectl exec -n $NAMESPACE $POD -- kill -SIGTERM 1

# 3. Monitor logs
echo -e "\nMonitoring shutdown sequence..."
kubectl logs -f -n $NAMESPACE $POD

# Expected output:
# SIGTERM received, initiating graceful shutdown...
# Closing HTTP server...
# HTTP server closed, no longer accepting connections
# Socket.IO cleanup initiated via module destroy hooks
# Socket.IO graceful shutdown initiated
# Notifying X clients of shutdown...
# Grace period complete
# Exiting gracefully
```

---

## Scaling Operations

### Manual Scaling

```bash
# Scale up
kubectl scale deployment/chat-backend --replicas=5 -n chat-backend-prod

# Scale down (gradual)
kubectl scale deployment/chat-backend --replicas=3 -n chat-backend-prod

# Watch scaling progress
kubectl get pods -n chat-backend-prod -w
```

### Auto-Scaling Tuning

```bash
# Check HPA status
kubectl get hpa chat-backend -n chat-backend-prod -o yaml

# Adjust thresholds (edit HPA)
kubectl edit hpa chat-backend -n chat-backend-prod

# Monitor scaling events
kubectl get events -n chat-backend-prod --sort-by='.lastTimestamp' | grep HorizontalPodAutoscaler
```

**Scaling Best Practices**:
- **Scale Up**: Aggressive (double pods immediately under load)
- **Scale Down**: Conservative (wait 5 minutes, reduce 50% at a time)
- **Minimum Replicas**: 3 (ensures availability during zone failures)
- **Maximum Replicas**: 10 (adjust based on database connection pool size)

---

## Failover Scenarios

### Scenario 1: Single Pod Failure

**Symptoms**:
- One pod unhealthy/terminated
- Partial connection loss (<33% if 3 replicas)

**Expected Behavior**:
1. Readiness probe fails → LB removes pod from pool
2. Liveness probe fails → Kubernetes restarts pod
3. Clients reconnect automatically to healthy pods (resume protocol)
4. New pod becomes ready → LB adds back to pool

**Operator Actions**:
```bash
# Check failing pod
kubectl describe pod <pod-name> -n chat-backend-prod

# View logs
kubectl logs <pod-name> -n chat-backend-prod --tail=200

# Force delete if stuck terminating
kubectl delete pod <pod-name> -n chat-backend-prod --force --grace-period=0
```

### Scenario 2: Availability Zone Failure

**Symptoms**:
- All pods in one zone unreachable
- Partial service degradation
- Increased connection churn

**Expected Behavior**:
1. Pods in affected zone fail health checks
2. LB removes affected pods from pool
3. Traffic routes to healthy zones
4. Clients reconnect to healthy pods
5. Kubernetes reschedules pods to healthy zones

**Operator Actions**:
```bash
# Identify affected zone
kubectl get nodes -o wide | grep <zone>

# Cordon nodes in affected zone
kubectl get nodes -l topology.kubernetes.io/zone=<zone> -o name | \
  xargs -I {} kubectl cordon {}

# Check pod distribution
kubectl get pods -n chat-backend-prod -o wide | awk '{print $1, $7}'

# Monitor connection metrics
kubectl logs -n chat-backend-prod -l app=chat-backend --tail=100 | grep -i disconnect

# Once zone recovers, uncordon nodes
kubectl get nodes -l topology.kubernetes.io/zone=<zone> -o name | \
  xargs -I {} kubectl uncordon {}
```

**Success Criteria**:
- Connection churn <1% of active connections
- Reconnect time <5 seconds p95
- Zero data loss (messages replayed via resume protocol)

### Scenario 3: Database Failover

**Symptoms**:
- Health checks failing (`/health/database` returns 503)
- All pods marked unready
- Connection writes failing

**Expected Behavior**:
1. Liveness probes fail → Pods remain running but unready
2. LB stops routing to all pods
3. Database failover completes (RDS: 1-2 minutes)
4. Pods reconnect to new database primary
5. Health checks pass → Pods become ready

**Operator Actions**:
```bash
# Check database health
kubectl exec -n chat-backend-prod deployment/chat-backend -- \
  curl -s http://localhost:3001/health/database

# Monitor database connection status
kubectl logs -n chat-backend-prod -l app=chat-backend --tail=50 | grep -i database

# If stuck, restart pods to force reconnect
kubectl rollout restart deployment/chat-backend -n chat-backend-prod

# Verify recovery
kubectl get pods -n chat-backend-prod
kubectl exec -n chat-backend-prod deployment/chat-backend -- \
  curl -s http://localhost:3001/health
```

### Scenario 4: Redis Cluster Failure

**Symptoms**:
- Presence heartbeat errors in logs
- Socket.IO adapter errors
- Cross-pod messaging broken

**Expected Behavior**:
1. Pods continue serving WebSocket connections (degraded mode)
2. Presence tracking disabled
3. Cross-pod messaging disabled (single-pod only)
4. Redis cluster recovers
5. Pods reconnect automatically

**Operator Actions**:
```bash
# Check Redis connectivity
kubectl exec -n chat-backend-prod deployment/chat-backend -- \
  redis-cli -h redis-service ping

# View Redis-related errors
kubectl logs -n chat-backend-prod -l app=chat-backend --tail=100 | grep -i redis

# Restart Redis (if self-managed)
kubectl rollout restart statefulset/redis -n infrastructure

# Verify recovery
kubectl logs -n chat-backend-prod -l app=chat-backend --tail=20 | grep "Redis adapter"
```

---

## Incident Response

### Severity Levels

| Severity | Definition | Response Time | Example |
|----------|-----------|---------------|---------|
| **P0 - Critical** | Complete service outage | 15 minutes | All pods down, database unreachable |
| **P1 - High** | Partial outage or severe degradation | 1 hour | >50% connection failures, zone failure |
| **P2 - Medium** | Performance degradation | 4 hours | High latency, increased error rate |
| **P3 - Low** | Minor issues, no user impact | Next business day | Single pod restarts, low churn |

### Incident Response Checklist

#### Immediate Actions (First 15 minutes)

1. **Assess Impact**:
   ```bash
   kubectl get pods -n chat-backend-prod
   kubectl top pods -n chat-backend-prod
   kubectl logs -n chat-backend-prod -l app=chat-backend --tail=100
   ```

2. **Check Dependencies**:
   - Database: `curl https://chat.example.com/health/database`
   - Redis: `redis-cli -h redis-service ping`
   - Load Balancer: Check ALB/NGINX metrics

3. **Notify Stakeholders**:
   - Post in incident channel
   - Page on-call engineer if P0/P1
   - Update status page

#### Investigation (Next 30 minutes)

1. **Gather Logs**:
   ```bash
   kubectl logs -n chat-backend-prod --all-containers=true --tail=500 > incident-logs.txt
   ```

2. **Check Recent Changes**:
   ```bash
   kubectl rollout history deployment/chat-backend -n chat-backend-prod
   ```

3. **Review Metrics**:
   - Grafana dashboards: Connection churn, error rates, latency
   - CloudWatch/Datadog: Infrastructure metrics

#### Resolution

1. **Apply Fix**:
   - Rollback if deployment-related: `kubectl rollout undo`
   - Scale up if capacity issue: `kubectl scale`
   - Restart if transient issue: `kubectl rollout restart`

2. **Verify Recovery**:
   ```bash
   kubectl get pods -n chat-backend-prod
   curl https://chat.example.com/health
   ```

3. **Monitor Stability** (next 30 minutes):
   - Connection churn back to normal (<1%)
   - Error rates back to baseline
   - No repeated failures

#### Post-Incident

1. **Write Post-Mortem** (within 48 hours):
   - Timeline of events
   - Root cause analysis
   - Action items to prevent recurrence

2. **Update Runbooks**:
   - Document new failure modes
   - Improve monitoring/alerting

---

## Health Check Reference

### Endpoint: `/health`

**Purpose**: Readiness check (is pod ready to accept traffic?)

**Expected Response** (HTTP 200):
```json
{
  "status": "ok",
  "timestamp": "2025-10-22T10:30:00.000Z",
  "uptime": 86400.5,
  "database": {
    "overall": "healthy"
  }
}
```

**Failure Response** (HTTP 503):
```json
{
  "status": "error",
  "database": {
    "overall": "unhealthy"
  }
}
```

**Kubernetes Config**:
```yaml
readinessProbe:
  exec:
    command:
    - /bin/sh
    - -c
    - |
      if [ -f /tmp/shutdown-initiated ]; then exit 1; fi
      curl -f http://localhost:3001/health || exit 1
  periodSeconds: 5
  failureThreshold: 2
```

### Endpoint: `/health/database`

**Purpose**: Liveness check (is database connection healthy?)

**Expected Response** (HTTP 200):
```json
{
  "summary": {
    "overall": "healthy",
    "database": "connected",
    "operationsSuccessful": true
  }
}
```

**Kubernetes Config**:
```yaml
livenessProbe:
  httpGet:
    path: /health/database
    port: 3001
  periodSeconds: 10
  failureThreshold: 3
```

---

## Troubleshooting Guide

### Problem: High Connection Churn

**Symptoms**:
- Frequent disconnects/reconnects
- Logs show `disconnect: transport close` or `heartbeat_timeout`

**Diagnosis**:
```bash
# Check disconnect reasons
kubectl logs -n chat-backend-prod -l app=chat-backend --tail=500 | \
  grep "socket.disconnect" | \
  jq -r '.data.reason' | \
  sort | uniq -c

# Check LB timeout settings
kubectl get ingress chat-backend-ingress -n chat-backend-prod -o yaml | \
  grep timeout
```

**Common Causes**:
1. **LB Timeout Too Short**: Increase `proxy_read_timeout` to 80s
2. **Backend Overload**: Scale up replicas
3. **Network Issues**: Check inter-AZ latency

**Solution**:
```bash
# Update ingress timeout
kubectl annotate ingress chat-backend-ingress \
  nginx.ingress.kubernetes.io/proxy-read-timeout="80" \
  -n chat-backend-prod --overwrite

# Scale up
kubectl scale deployment/chat-backend --replicas=5 -n chat-backend-prod
```

### Problem: Sessions Not Sticky

**Symptoms**:
- Clients report "Resume failed: cursor not found"
- Same user ID appears in multiple pod logs

**Diagnosis**:
```bash
# Check ingress affinity
kubectl get ingress chat-backend-ingress -n chat-backend-prod -o yaml | \
  grep affinity

# Test stickiness
for i in {1..10}; do
  curl -v -c /tmp/cookies.txt -b /tmp/cookies.txt \
    https://chat.example.com/health 2>&1 | \
    grep "X-Backend"
done
```

**Solution**:
```bash
# Enable cookie affinity
kubectl annotate ingress chat-backend-ingress \
  nginx.ingress.kubernetes.io/affinity="cookie" \
  nginx.ingress.kubernetes.io/session-cookie-name="chat_session" \
  -n chat-backend-prod --overwrite
```

### Problem: Pods OOMKilled

**Symptoms**:
- Pods restarting frequently
- Status shows `OOMKilled`

**Diagnosis**:
```bash
# Check memory usage
kubectl top pods -n chat-backend-prod

# Check resource limits
kubectl get deployment chat-backend -n chat-backend-prod -o yaml | \
  grep -A 4 resources
```

**Solution**:
```bash
# Increase memory limits
kubectl set resources deployment/chat-backend \
  --limits=memory=1Gi \
  --requests=memory=512Mi \
  -n chat-backend-prod

# Or enable swap (if Kubernetes supports)
```

---

## Contact & Escalation

**Primary On-Call**: #infrastructure-oncall  
**Secondary On-Call**: #platform-team  
**Escalation Manager**: #engineering-leadership

**Related Documentation**:
- [Load Balancer Configuration](./LOAD_BALANCER_CONFIGURATION.md)
- [Monitoring Guide](../operations/monitoring.md)
- [Architecture Overview](../architecture/README.md)

---

**Last Updated**: 2025-10-22  
**Maintained By**: Infrastructure Engineering Team  
**Next Review**: Monthly
