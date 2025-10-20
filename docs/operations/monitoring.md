# Operational Monitoring Guide

**Version**: 1.0  
**Last Updated**: October 20, 2025  
**Audience**: DevOps, SRE, Operations Teams

---

## Overview

This document describes key metrics, monitoring dashboards, alerting strategies, and operational runbooks for the chat backend service running in a **no-authentication, public-access model**.

---

## Key Metrics

### Request Metrics

| Metric | Description | Normal Range | Alert Threshold |
|--------|-------------|--------------|-----------------|
| **Request Rate** | Requests per second (RPS) | 10-100 RPS | > 200 RPS sustained |
| **Error Rate** | % of requests returning 4xx/5xx | < 2% | > 5% for 5 minutes |
| **Request Latency P50** | Median response time | < 100ms | > 500ms sustained |
| **Request Latency P95** | 95th percentile response time | < 500ms | > 2000ms sustained |
| **Request Latency P99** | 99th percentile response time | < 1000ms | > 5000ms sustained |

### Socket.IO Metrics

| Metric | Description | Normal Range | Alert Threshold |
|--------|-------------|--------------|-----------------|
| **Active Connections** | Current WebSocket connections | 100-1000 | > 5000 |
| **Connection Rate** | New connections per second | 1-10/sec | > 50/sec sustained |
| **Disconnection Rate** | Disconnections per second | 1-10/sec | > 50/sec sustained |
| **Message Rate** | Messages per second | 10-100/sec | > 500/sec sustained |
| **Failed Handshakes** | Failed connection attempts | < 1% | > 10% for 5 minutes |

### Rate Limiting Metrics

| Metric | Description | Normal Range | Alert Threshold |
|--------|-------------|--------------|-----------------|
| **Rate Limit Hits** | Requests rejected by rate limiter | < 5% | > 20% for 10 minutes |
| **Unique IPs Throttled** | Number of IPs hitting rate limits | < 10 | > 100 per hour |
| **Upload Limit Hits** | File uploads rejected | < 2% | > 10% for 5 minutes |

### Resource Metrics

| Metric | Description | Normal Range | Alert Threshold |
|--------|-------------|--------------|-----------------|
| **CPU Usage** | CPU utilization | 20-60% | > 80% for 5 minutes |
| **Memory Usage** | RAM utilization | 40-70% | > 85% sustained |
| **Database Connections** | Active Prisma connections | 5-20 | > 50 |
| **Database Query Time P95** | 95th percentile query latency | < 50ms | > 500ms sustained |

### Business Metrics

| Metric | Description | Normal Range | Alert Threshold |
|--------|-------------|--------------|-----------------|
| **Message Delivery Success** | % messages successfully delivered | > 99% | < 95% for 5 minutes |
| **Average Messages/Conversation** | Messages per conversation | 5-50 | N/A |
| **Active Conversations** | Conversations with activity in last 24h | Varies | Trending down > 50% |

---

## Monitoring Endpoints

### Health Check

```bash
GET /health

Response:
{
  "status": "OK",
  "timestamp": "2025-10-20T10:30:00Z",
  "uptime": 86400
}
```

### Database Health

```bash
GET /health/database

Response:
{
  "status": "OK",
  "database": "Connected",
  "timestamp": "2025-10-20T10:30:00Z"
}
```

### Metrics Endpoint

```bash
GET /metrics

Response:
{
  "requests": {
    "total": 15234,
    "byEndpoint": {
      "POST /api/chat/messages": 5432,
      "GET /api/chat/conversations": 3421,
      "POST /api/chat/conversations": 1234
    }
  },
  "errors": {
    "total": 142,
    "rate": "0.93%",
    "byEndpoint": {
      "POST /api/chat/messages": 89,
      "GET /api/chat/conversations": 53
    }
  },
  "latency": {
    "average": 145,
    "p95": 487,
    "unit": "ms"
  },
  "connections": {
    "active": 342
  },
  "timestamp": "2025-10-20T10:30:00Z"
}
```

**Scraping**: Configure your monitoring system (Prometheus, Datadog, etc.) to scrape `/metrics` every 15-30 seconds.

---

## Dashboard Recommendations

### Primary Operations Dashboard

**Panels**:
1. **Request Rate (RPS)** - Line graph, 1-hour window
2. **Error Rate %** - Line graph with 5% threshold line
3. **P95 Latency** - Line graph with 500ms threshold
4. **Active Socket Connections** - Single stat + trend
5. **Rate Limit Hits** - Line graph by IP
6. **CPU/Memory Usage** - Dual-axis line graph

**Refresh**: 30 seconds  
**Time Range**: Last 6 hours with ability to zoom

### Security Dashboard

**Panels**:
1. **Rate Limit Violations by IP** - Bar chart, top 20 IPs
2. **4xx Error Rate by Endpoint** - Heatmap
3. **Failed File Uploads** - Table with rejection reasons
4. **Suspicious Activity Patterns** - List (high message rate from single IP)
5. **Blocked IPs** - Count + list

**Refresh**: 1 minute  
**Time Range**: Last 24 hours

### Business Metrics Dashboard

**Panels**:
1. **Total Messages Sent** - Single stat + trend
2. **Active Conversations** - Single stat + trend
3. **New Conversations Created** - Line graph
4. **Messages per Conversation Distribution** - Histogram
5. **User Activity by Hour** - Heatmap

**Refresh**: 5 minutes  
**Time Range**: Last 7 days

---

## Log Formats

### Request Log

```json
{
  "type": "request",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2025-10-20T10:30:15.123Z",
  "method": "POST",
  "url": "/api/chat/messages",
  "ip": "192.168.1.100",
  "userAgent": "Mozilla/5.0...",
  "userId": "user-12345",
  "referer": "https://example.com",
  "contentType": "application/json",
  "contentLength": "245"
}
```

### Response Log

```json
{
  "type": "response",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2025-10-20T10:30:15.345Z",
  "method": "POST",
  "url": "/api/chat/messages",
  "statusCode": 200,
  "duration": "222ms",
  "userId": "user-12345",
  "ip": "192.168.1.100"
}
```

### Error Log

```json
{
  "type": "error",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2025-10-20T10:30:15.345Z",
  "method": "POST",
  "url": "/api/chat/messages",
  "ip": "192.168.1.100",
  "userId": "user-12345",
  "error": {
    "name": "ValidationError",
    "message": "Message content is required",
    "stack": "..." 
  },
  "body": { "conversationId": "conv-123" },
  "query": {}
}
```

**Sensitive Data**: Automatically redacted (passwords, tokens, etc.)

---

## Alerting Rules

### Critical Alerts (PagerDuty/On-Call)

1. **Service Down**
   - Condition: Health check fails for 2 consecutive checks
   - Action: Page on-call engineer immediately
   
2. **High Error Rate**
   - Condition: Error rate > 10% for 5 minutes
   - Action: Page on-call engineer
   
3. **Database Connection Failure**
   - Condition: Database health check fails
   - Action: Page on-call engineer + DBA
   
4. **Memory Leak Detected**
   - Condition: Memory usage > 90% and increasing
   - Action: Page on-call engineer

### High Priority Alerts (Slack/Email)

1. **Elevated Error Rate**
   - Condition: Error rate > 5% for 5 minutes
   - Action: Notify team channel
   
2. **High Latency**
   - Condition: P95 latency > 2s for 5 minutes
   - Action: Notify team channel
   
3. **Rate Limit Abuse**
   - Condition: > 100 unique IPs throttled in 1 hour
   - Action: Notify security team
   
4. **Connection Surge**
   - Condition: Active connections > 5000
   - Action: Notify operations team

### Warning Alerts (Slack)

1. **Increasing Error Rate**
   - Condition: Error rate > 2% for 10 minutes
   - Action: Notify team channel (no page)
   
2. **Degraded Performance**
   - Condition: P95 latency > 500ms for 10 minutes
   - Action: Notify team channel
   
3. **Resource Pressure**
   - Condition: CPU > 70% or Memory > 75% for 10 minutes
   - Action: Notify operations team

---

## Common Issues & Runbooks

### Issue: High Error Rate (5xx)

**Symptoms**:
- Elevated 500/502/503 errors
- Users reporting failures
- Metrics dashboard shows red

**Diagnosis**:
```bash
# Check recent errors
tail -n 100 /var/log/chat-backend/error.log | jq 'select(.statusCode >= 500)'

# Check database connectivity
curl http://localhost:3001/health/database

# Check CPU/Memory
top -bn1 | grep "chat-backend"
```

**Resolution**:
1. Check database connection health
2. Review error logs for stack traces
3. Restart service if unresponsive: `systemctl restart chat-backend`
4. Scale horizontally if load-related: `kubectl scale deployment chat-backend --replicas=5`

**Escalation**: If errors persist after restart, page backend engineer

---

### Issue: Rate Limit Abuse

**Symptoms**:
- High rate of 429 responses
- Single IP or small set of IPs dominating traffic
- Legitimate users may be affected

**Diagnosis**:
```bash
# Check top IPs by request count
tail -n 10000 /var/log/chat-backend/access.log | \
  jq -r '.ip' | sort | uniq -c | sort -rn | head -20

# Check rate limit violations
grep '"statusCode":429' /var/log/chat-backend/response.log | \
  jq -r '.ip' | sort | uniq -c | sort -rn
```

**Resolution**:
1. Identify abusive IPs from logs
2. Add temporary block at load balancer/firewall:
   ```bash
   # Example: iptables
   iptables -A INPUT -s 192.168.1.100 -j DROP
   
   # Example: nginx
   # Add to nginx.conf: deny 192.168.1.100;
   ```
3. Reduce rate limits temporarily if needed (edit `src/middleware/rateLimiter.ts`)
4. Contact upstream service/gateway to enforce auth-level rate limits

**Prevention**:
- Implement IP blacklist feature
- Add CAPTCHA for suspicious patterns
- Coordinate with upstream gateway for user-level rate limiting

---

### Issue: High Latency

**Symptoms**:
- P95 latency > 2s
- Users report slow responses
- Dashboard shows degraded performance

**Diagnosis**:
```bash
# Check slow database queries
# (Prisma query logging enabled in development)
grep "slow query" /var/log/chat-backend/app.log

# Check active connections
curl http://localhost:3001/metrics | jq '.connections.active'

# Check system load
uptime
iostat -x 1 5
```

**Resolution**:
1. **Database Slow Queries**:
   - Review Prisma query logs
   - Add missing indexes
   - Optimize n+1 query patterns

2. **High Connection Count**:
   - Scale horizontally: add more service instances
   - Implement connection pooling (Prisma already does this)

3. **Network Congestion**:
   - Check network latency to database
   - Review load balancer configuration

4. **Memory Pressure**:
   - Check for memory leaks: `node --inspect`
   - Restart service to clear: `systemctl restart chat-backend`

**Escalation**: If latency persists > 30 minutes, page backend + infrastructure engineers

---

### Issue: Socket.IO Connection Issues

**Symptoms**:
- Failed handshakes > 10%
- High disconnection rate
- Users report WebSocket errors

**Diagnosis**:
```bash
# Check Socket.IO logs
grep "socket" /var/log/chat-backend/app.log | tail -100

# Check active connections
curl http://localhost:3001/metrics | jq '.connections'

# Check WebSocket proxy configuration (nginx/ALB)
# Ensure upgrade headers are passed correctly
```

**Resolution**:
1. **Proxy Misconfiguration**:
   - Verify WebSocket upgrade headers in nginx/ALB
   - Example nginx config:
     ```nginx
     location /socket.io/ {
       proxy_pass http://backend;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
     }
     ```

2. **Connection Limit Reached**:
   - Scale horizontally
   - Implement sticky sessions at load balancer

3. **Client-Side Issues**:
   - Check client library versions
   - Verify client reconnection logic

**Escalation**: If connections fail > 20%, page on-call engineer

---

### Issue: Database Connection Pool Exhausted

**Symptoms**:
- Errors mentioning "connection pool"
- High number of active database connections
- Slow queries or timeouts

**Diagnosis**:
```bash
# Check Prisma connection pool status
# (Add monitoring to Prisma client)

# Check database connections from DB side
psql -U postgres -c "SELECT count(*) FROM pg_stat_activity;"
```

**Resolution**:
1. **Increase Pool Size**:
   - Edit `DATABASE_URL` connection string
   - Add `?connection_limit=20&pool_timeout=20`

2. **Find Connection Leaks**:
   - Review code for missing `prisma.$disconnect()`
   - Check for long-running transactions

3. **Scale Database**:
   - Increase database instance size
   - Add read replicas for read-heavy queries

**Prevention**:
- Always use connection pooling
- Set appropriate timeouts
- Monitor connection count continuously

---

## Scaling Strategies

### Horizontal Scaling

**When to Scale**:
- CPU > 70% sustained
- Request latency P95 > 1s sustained
- Active connections > 3000 per instance

**How to Scale**:
```bash
# Kubernetes
kubectl scale deployment chat-backend --replicas=10

# Docker Swarm
docker service scale chat-backend=10

# Manual
# Deploy additional instances behind load balancer
```

**Load Balancing**:
- Use sticky sessions for Socket.IO
- Round-robin for HTTP API endpoints
- Health check: `GET /health`

### Vertical Scaling

**When to Scale**:
- Memory usage consistently > 70%
- CPU throttling detected
- Database queries slow despite indexing

**How to Scale**:
```bash
# Kubernetes
kubectl set resources deployment chat-backend \
  --requests=cpu=2,memory=4Gi \
  --limits=cpu=4,memory=8Gi

# Docker
# Update docker-compose.yml resource limits
```

### Database Scaling

**Read Replicas**:
- Use for message history queries
- Prisma read replica support:
  ```typescript
  const replica = new PrismaClient({
    datasources: {
      db: { url: process.env.DATABASE_REPLICA_URL }
    }
  });
  ```

**Connection Pooling**:
- PgBouncer for connection pooling
- Reduces database load

---

## Security Monitoring

### Suspicious Activity Patterns

1. **Rapid Message Sending**:
   - > 50 messages/minute from single userId
   - Action: Log + notify security team

2. **Enumeration Attacks**:
   - Sequential conversation ID requests
   - Action: Rate limit more aggressively

3. **Large Payload Attacks**:
   - Multiple rejected large file uploads
   - Action: Block IP temporarily

4. **Cross-Conversation Scanning**:
   - Single user accessing many conversations
   - Action: Monitor + alert if abuse confirmed

### Audit Logs

All actions are logged with:
- Request ID (for tracing)
- IP address
- userId (opaque, untrusted)
- Action performed
- Timestamp

**Retention**: 90 days (configurable)  
**Storage**: Structured logs in Elasticsearch/CloudWatch

---

## Backup & Recovery

### Database Backups

**Schedule**: 
- Automated daily backups at 02:00 UTC
- Continuous WAL archiving for point-in-time recovery

**Retention**: 30 days

**Testing**: Monthly restore test to staging

### Disaster Recovery

**RTO** (Recovery Time Objective): < 4 hours  
**RPO** (Recovery Point Objective): < 1 hour

**Procedure**:
1. Restore database from latest backup
2. Deploy service from last known good image
3. Verify health checks pass
4. Gradually restore traffic

---

## Performance Tuning

### Database Optimization

1. **Indexes**: Ensure indexes on:
   - `messages(conversationId, createdAt)`
   - `conversations(participantIds)`
   - `messages(userId)`

2. **Query Optimization**:
   - Use `select` to fetch only needed fields
   - Implement cursor-based pagination
   - Avoid N+1 queries with `include`

3. **Connection Pooling**:
   - Set appropriate pool size (10-20)
   - Configure timeouts (10-30s)

### Application Optimization

1. **Caching**:
   - Implement Redis for frequently accessed data
   - Cache conversation participant lists
   - Cache user online status

2. **Rate Limiting**:
   - Use Redis for distributed rate limiting
   - Adjust limits based on traffic patterns

3. **Payload Compression**:
   - Enable gzip compression for responses
   - Already configured in helmet middleware

---

## Contact & Escalation

### Team Contacts

- **Operations Team**: ops@example.com
- **Backend Engineering**: backend-eng@example.com
- **Security Team**: security@example.com
- **Database Team**: dba@example.com

### On-Call Rotation

- Primary: Check PagerDuty schedule
- Secondary: Check PagerDuty schedule
- Manager: engineering-manager@example.com

### Escalation Path

1. **Level 1**: On-call engineer (PagerDuty)
2. **Level 2**: Backend team lead
3. **Level 3**: Engineering manager
4. **Level 4**: CTO

---

**Document Owner**: Operations Team  
**Review Cycle**: Quarterly  
**Last Review**: October 20, 2025
