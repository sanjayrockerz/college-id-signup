# Monitoring Stack Setup Guide

## Overview

This guide covers setting up comprehensive monitoring for the chat backend infrastructure:

- **Prometheus**: Metrics collection and storage
- **Grafana**: Visualization and dashboards
- **Exporters**: PgBouncer, PostgreSQL, Redis, Node metrics

---

## Quick Start

### 1. Start Monitoring Stack

```bash
# Start all monitoring services
docker-compose --profile monitoring up -d

# Verify services are running
docker-compose --profile monitoring ps
```

Expected output:

```
NAME                                    STATUS    PORTS
chat-backend-grafana                    Up        0.0.0.0:3000->3000/tcp
chat-backend-prometheus                 Up        0.0.0.0:9090->9090/tcp
chat-backend-pgbouncer-exporter         Up        0.0.0.0:9127->9127/tcp
chat-backend-postgres-exporter          Up        0.0.0.0:9187->9187/tcp
chat-backend-redis-exporter             Up        0.0.0.0:9121->9121/tcp
chat-backend-node-exporter              Up        0.0.0.0:9100->9100/tcp
```

### 2. Access Monitoring Interfaces

| Service                | URL                           | Credentials   |
| ---------------------- | ----------------------------- | ------------- |
| **Grafana**            | http://localhost:3000         | admin / admin |
| **Prometheus**         | http://localhost:9090         | -             |
| **PgBouncer Metrics**  | http://localhost:9127/metrics | -             |
| **PostgreSQL Metrics** | http://localhost:9187/metrics | -             |
| **Redis Metrics**      | http://localhost:9121/metrics | -             |
| **Node Metrics**       | http://localhost:9100/metrics | -             |

### 3. View Dashboards

1. Open Grafana: http://localhost:3000
2. Login with `admin / admin`
3. Navigate to Dashboards → "Chat Backend - Performance & Pooling Dashboard"

---

## Dashboard Panels

### PgBouncer Monitoring

**Connection Pool Status**

- Active Connections (database operations in progress)
- Idle Connections (available in pool)
- Client Connections (waiting for pool)

**Queue Wait Time Gauge**

- Green: <0.5s (healthy)
- Yellow: 0.5-1s (warning)
- Red: >1s (critical - scale pool)

**Query & Transaction Rate**

- Queries per second
- Transactions per second
- Use for capacity planning

### Redis Cache Monitoring

**Cache Hit Ratio**

- Target: >60% after warmup
- Tracks cache effectiveness
- Low ratio indicates TTL tuning needed

**Cache Operations Rate**

- Hits per second
- Misses per second
- Evictions per second (should be low)

**Memory Usage**

- Used vs Max memory
- Alert if >90% capacity
- Tune maxmemory policy if needed

### Application Performance

**Request Latency Percentiles**

- p50 (median): typical user experience
- p95: most users experience better
- p99: worst-case scenarios

**Request Rate by Status**

- 2xx Success rate
- 4xx Client errors (validation, auth)
- 5xx Server errors (should be near zero)

---

## Alert Rules

### Critical Alerts (Immediate Action)

**PgBouncer Pool Saturated**

- Trigger: Pool usage >90% for 5+ minutes
- Action: Increase DEFAULT_POOL_SIZE in docker-compose.yml

**High Error Rate**

- Trigger: HTTP 5xx errors >1% for 3+ minutes
- Action: Check application logs, database connectivity

**Redis Rejecting Connections**

- Trigger: Any rejected connections
- Action: Check Redis memory, restart if needed

### Warning Alerts (Monitor)

**High Queue Wait**

- Trigger: Average wait >1s for 3+ minutes
- Action: Consider scaling database or tuning queries

**Low Cache Hit Ratio**

- Trigger: Hit ratio <40% for 10+ minutes
- Action: Review TTL settings, cache key strategy

**Latency Degradation**

- Trigger: P95 latency increased by 50%
- Action: Check recent deployments, database performance

---

## Prometheus Queries

### PgBouncer Metrics

```promql
# Connection pool utilization
pgbouncer_pools_server_active_connections / pgbouncer_pools_server_max_connections

# Average wait time
pgbouncer_stats_avg_wait_time_seconds

# Queued queries
pgbouncer_stats_queries_queued_total

# Transaction rate
rate(pgbouncer_stats_transactions_total[5m])
```

### Redis Cache Metrics

```promql
# Cache hit ratio
cache_hit_ratio

# Cache operations rate
rate(cache_hits_total[5m])
rate(cache_misses_total[5m])

# Memory usage
redis_memory_used_bytes / redis_memory_max_bytes
```

### Application Metrics

```promql
# P95 latency
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# Request rate
rate(http_requests_total[5m])

# Error rate
rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m])
```

---

## Tuning Based on Metrics

### Scenario: High Queue Wait Times

**Symptoms**:

- `pgbouncer_stats_avg_wait_time_seconds > 1`
- `pgbouncer_stats_queries_queued_total` increasing

**Solutions**:

1. Increase pool size:

   ```yaml
   DEFAULT_POOL_SIZE=30 # was 20
   ```

2. Optimize slow queries:

   ```sql
   -- Find slow queries in PostgreSQL
   SELECT query, mean_exec_time, calls
   FROM pg_stat_statements
   ORDER BY mean_exec_time DESC
   LIMIT 10;
   ```

3. Scale database vertically (more CPU/RAM)

### Scenario: Low Cache Hit Ratio

**Symptoms**:

- `cache_hit_ratio < 0.4` for extended period
- High `cache_misses_total` rate

**Solutions**:

1. Increase TTL for stable data:

   ```typescript
   const ttl = getMessageHistoryTTL(offset);
   // Adjust: 30s → 60s for recent messages
   ```

2. Increase Redis memory:

   ```yaml
   - "--maxmemory"
   - "1024mb" # was 512mb
   ```

3. Review cache key patterns (ensure no cache thrashing)

### Scenario: High Latency

**Symptoms**:

- `histogram_quantile(0.95, ...) > 0.5` (500ms)
- Latency increased compared to baseline

**Solutions**:

1. Check if cache is helping:
   - Compare latency with/without cache
   - Verify cache hit ratio >60%

2. Review database query performance:

   ```sql
   EXPLAIN ANALYZE SELECT ... -- check query plans
   ```

3. Check connection pool saturation

---

## Monitoring Stack Operations

### Start/Stop

```bash
# Start monitoring
docker-compose --profile monitoring up -d

# Stop monitoring (keeps data)
docker-compose --profile monitoring stop

# Remove monitoring (deletes data)
docker-compose --profile monitoring down -v
```

### View Logs

```bash
# Prometheus logs
docker logs chat-backend-prometheus -f

# Grafana logs
docker logs chat-backend-grafana -f

# PgBouncer exporter logs
docker logs chat-backend-pgbouncer-exporter -f
```

### Backup Grafana Dashboards

```bash
# Export dashboard JSON
curl -u admin:admin http://localhost:3000/api/dashboards/uid/chat-backend-perf > backup-dashboard.json

# Import dashboard
curl -X POST -H "Content-Type: application/json" \
  -d @backup-dashboard.json \
  -u admin:admin http://localhost:3000/api/dashboards/db
```

### Prometheus Data Retention

```yaml
# In docker-compose.yml, adjust retention
command:
  - "--storage.tsdb.retention.time=30d" # Default
  - "--storage.tsdb.retention.time=90d" # Extended
```

---

## Troubleshooting

### Prometheus Can't Scrape Targets

**Check target status**: http://localhost:9090/targets

**Common issues**:

1. Exporter not running:

   ```bash
   docker-compose --profile monitoring ps
   ```

2. Network connectivity:

   ```bash
   docker network inspect college-id-signup-1_chat-network
   ```

3. Firewall blocking ports:
   ```bash
   # Test from Prometheus container
   docker exec chat-backend-prometheus wget -O- http://pgbouncer-exporter:9127/metrics
   ```

### Grafana Dashboard Not Loading

1. **Check datasource**:
   - Grafana → Configuration → Data Sources
   - Test Prometheus connection

2. **Verify Prometheus has data**:

   ```bash
   curl http://localhost:9090/api/v1/query?query=up
   ```

3. **Re-import dashboard**:
   - Copy dashboard JSON from `config/grafana/dashboards/`
   - Grafana → Import → Paste JSON

### Missing Metrics

1. **PgBouncer metrics**: Ensure admin credentials are correct

   ```bash
   PGPASSWORD=password psql -h localhost -p 6432 -U postgres pgbouncer -c "SHOW STATS;"
   ```

2. **Redis metrics**: Check redis-exporter can connect

   ```bash
   docker logs chat-backend-redis-exporter
   ```

3. **Application metrics**: Verify app exports Prometheus format
   ```bash
   curl http://localhost:3001/metrics
   ```

---

## Production Recommendations

### 1. External Prometheus Storage

For production, use remote storage (Thanos, Cortex, or cloud provider):

```yaml
# prometheus.yml
remote_write:
  - url: "https://prometheus-remote-write.example.com/api/v1/write"
    basic_auth:
      username: "your-username"
      password: "your-password"
```

### 2. Alert Manager Integration

Configure Alertmanager for notifications (email, Slack, PagerDuty):

```yaml
# docker-compose.yml
alertmanager:
  image: prom/alertmanager:latest
  ports:
    - "9093:9093"
  volumes:
    - ./config/alertmanager/alertmanager.yml:/etc/alertmanager/alertmanager.yml
```

### 3. Grafana Authentication

Enable OAuth or LDAP for production:

```yaml
# docker-compose.yml
environment:
  - GF_AUTH_GENERIC_OAUTH_ENABLED=true
  - GF_AUTH_GENERIC_OAUTH_NAME=OAuth
  - GF_AUTH_GENERIC_OAUTH_CLIENT_ID=your-client-id
```

### 4. Secure Credentials

Use Docker secrets or environment files:

```bash
# .env.monitoring
GRAFANA_ADMIN_PASSWORD=<secure-password>
PROMETHEUS_REMOTE_WRITE_TOKEN=<api-token>
```

### 5. High Availability

Run multiple Prometheus instances with federation:

```yaml
# prometheus-ha.yml
scrape_configs:
  - job_name: "federate"
    honor_labels: true
    metrics_path: "/federate"
    params:
      "match[]":
        - '{job=~"chat-backend|pgbouncer|redis"}'
    static_configs:
      - targets:
          - "prometheus-1:9090"
          - "prometheus-2:9090"
```

---

## Next Steps

1. ✅ **Monitoring Stack**: Setup complete
2. ⏳ **Load Testing**: Run tests with monitoring active
3. ⏳ **Baseline Metrics**: Capture pre-optimization performance
4. ⏳ **Tuning**: Adjust based on observed metrics
5. ⏳ **Documentation**: Record optimal settings

---

## Support

- **Prometheus Docs**: https://prometheus.io/docs/
- **Grafana Docs**: https://grafana.com/docs/
- **PgBouncer Stats**: https://www.pgbouncer.org/usage.html#show-stats
- **Redis Metrics**: https://redis.io/commands/info/

---

**Generated**: October 22, 2025  
**Status**: Monitoring infrastructure ready for load testing
