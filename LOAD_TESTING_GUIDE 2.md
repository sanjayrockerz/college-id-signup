# Load Testing Guide

## Overview

This guide covers load testing the chat backend to measure:

- Connection pool effectiveness (PgBouncer)
- Cache impact on performance (Redis)
- System behavior under 1k, 5k, 10k concurrent connections

---

## Prerequisites

### 1. Install k6

```bash
# macOS
brew install k6

# Linux
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D00
echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6

# Verify installation
k6 version
```

### 2. Start All Services

```bash
# Start core services
docker-compose up -d

# Start monitoring stack
docker-compose --profile monitoring up -d

# Start application
npm run start:dev

# Verify all services are healthy
docker-compose ps
curl http://localhost:3001/api/v1/health
curl http://localhost:3001/api/v1/health/cache
```

### 3. Seed Test Data

```bash
# Create test data for load testing
npx tsx seed-cache-test.ts
```

---

## Test Scenarios

### Scenario 1: Baseline (No Cache)

**Purpose**: Measure database and connection pool performance without cache layer

**Configuration**:

```bash
# Disable cache in .env
CACHE_BYPASS=true

# OR use cache bypass header in k6 script
```

**Expected Results**:

- P95 latency: 200-300ms (database queries)
- Database connections: Managed by PgBouncer
- Queue wait times: <500ms at 10k connections

### Scenario 2: Full Stack (PgBouncer + Cache)

**Purpose**: Measure complete system with all optimizations

**Configuration**:

```bash
# Enable cache in .env
CACHE_BYPASS=false
ENABLE_REDIS_CACHE=true
```

**Expected Results**:

- P95 latency: 50-150ms (cache hits)
- Cache hit ratio: >60% after warmup
- 30-50% improvement vs baseline

### Scenario 3: Stress Test

**Purpose**: Find system breaking point and failure modes

**Configuration**:

- Ramp to 20k+ concurrent users
- Monitor for errors, timeouts, connection exhaustion

---

## Running Load Tests

### Test 1: Baseline Performance

```bash
# Run baseline test (5-10 minutes)
k6 run \
  --vus 100 \
  --duration 10m \
  --out json=results/baseline-test.json \
  tests/load/k6-baseline.js

# With custom parameters
BASE_URL=http://localhost:3001 \
CONVERSATION_ID=conv-1 \
USER_ID=user-1 \
k6 run tests/load/k6-baseline.js
```

**What to Monitor**:

1. Open Grafana: http://localhost:3000
2. Watch "PgBouncer - Connection Pool Status" panel
3. Note queue wait times at 1k, 5k, 10k connections
4. Record P50/P95/P99 latencies

### Test 2: Full Stack Performance

```bash
# Run full-stack test (cache enabled)
k6 run \
  --vus 100 \
  --duration 10m \
  --out json=results/full-stack-test.json \
  tests/load/k6-full-stack.js
```

**What to Monitor**:

1. Cache hit ratio (target >60%)
2. Request latency improvement vs baseline
3. Redis memory usage
4. PgBouncer pool still healthy

### Test 3: Staged Ramp Test

```bash
# Gradual ramp: 1k → 5k → 10k
k6 run tests/load/k6-full-stack.js

# Custom staging
k6 run --stage 2m:1000 --stage 3m:1000 \
       --stage 2m:5000 --stage 3m:5000 \
       --stage 2m:10000 --stage 3m:10000 \
       tests/load/k6-full-stack.js
```

**Capture Metrics at Each Stage**:
| Stage | VUs | Duration | P95 Latency | Queue Wait | Hit Ratio |
|-------|-----|----------|-------------|------------|-----------|
| 1 | 1,000 | 3min | **_ ms | _** ms | **_% |
| 2 | 5,000 | 3min | _** ms | **_ ms | _**% |
| 3 | 10,000 | 3min | **_ ms | _** ms | \_\_\_% |

### Test 4: Burst Traffic

```bash
# Simulate traffic spike
k6 run \
  --stage 1m:100 \
  --stage 30s:5000 \
  --stage 5m:5000 \
  --stage 1m:100 \
  tests/load/k6-full-stack.js
```

**Purpose**: Test cache warming and recovery from sudden load

---

## Interpreting Results

### k6 Output Metrics

```
✓ status is 200
✓ has messages
✓ response time < 500ms

checks.........................: 99.85% ✓ 45678  ✗ 67
data_received..................: 123 MB  205 kB/s
data_sent......................: 45 MB   75 kB/s
http_req_blocked...............: avg=1.2ms   min=0s   med=0s      max=234ms  p(90)=0s     p(95)=0s
http_req_connecting............: avg=840µs   min=0s   med=0s      max=189ms  p(90)=0s     p(95)=0s
http_req_duration..............: avg=142ms   min=8ms  med=98ms    max=2.1s   p(90)=287ms  p(95)=385ms
http_req_failed................: 0.15%  ✓ 67     ✗ 45678
http_req_receiving.............: avg=1.89ms  min=0s   med=1.2ms   max=89ms   p(90)=3.4ms  p(95)=4.8ms
http_req_sending...............: avg=245µs   min=0s   med=148µs   max=12ms   p(90)=489µs  p(95)=687µs
http_req_tls_handshaking.......: avg=0s      min=0s   med=0s      max=0s     p(90)=0s     p(95)=0s
http_req_waiting...............: avg=140ms   min=7ms  med=96ms    max=2.1s   p(90)=284ms  p(95)=382ms
http_reqs......................: 45745  76.2/s
iteration_duration.............: avg=1.32s   min=1.01s med=1.28s  max=3.2s   p(90)=1.52s  p(95)=1.67s
iterations.....................: 45745  76.2/s
vus............................: 100    min=0    max=100
vus_max........................: 100    min=100  max=100
```

### Key Metrics to Analyze

**1. Request Duration** (`http_req_duration`)

- **p(50)**: Median latency - typical user experience
- **p(95)**: 95% of requests faster than this
- **p(99)**: Worst-case latency for most users

**Target with cache**: p(95) < 300ms, p(99) < 600ms

**2. Error Rate** (`http_req_failed`)

- **Target**: < 1% (0.01)
- **Acceptable**: < 5% (0.05) under stress
- **Critical**: > 10% indicates system failure

**3. Throughput** (`http_reqs`)

- Requests per second system can handle
- Compare across different VU counts

**4. Custom Metrics**

- `cache_hit_rate`: Should exceed 60% after warmup
- `errors`: Application-specific error tracking
- `request_latency`: Custom latency measurement

---

## Analyzing Prometheus/Grafana Data

### During Load Test

**Open Grafana**: http://localhost:3000

**Monitor These Panels**:

1. **PgBouncer - Connection Pool Status**
   - Active vs Idle connections
   - Pool saturation (should stay <90%)

2. **PgBouncer - Queue Wait Time**
   - Should stay green (<500ms)
   - Yellow/Red indicates need to scale

3. **Redis - Cache Hit Ratio**
   - Watch it climb during warmup
   - Should stabilize above 60%

4. **Application - Request Latency Percentiles**
   - P95 should improve significantly with cache
   - P99 may have spikes during writes (cache invalidation)

### Post-Test Analysis

```promql
# Compare P95 latency: baseline vs full-stack
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# Cache hit ratio trend
cache_hit_ratio

# PgBouncer queue wait during peak load
pgbouncer_stats_avg_wait_time_seconds

# Connection pool utilization
pgbouncer_pools_server_active_connections / pgbouncer_pools_server_max_connections
```

---

## Performance Comparison Template

### Test Results Matrix

| Metric                    | Baseline (No Cache) | Full Stack (PgBouncer + Cache) | Improvement |
| ------------------------- | ------------------- | ------------------------------ | ----------- |
| **P50 Latency**           | \_\_\_ ms           | \_\_\_ ms                      | \_\_\_%     |
| **P95 Latency**           | \_\_\_ ms           | \_\_\_ ms                      | \_\_\_%     |
| **P99 Latency**           | \_\_\_ ms           | \_\_\_ ms                      | \_\_\_%     |
| **Error Rate**            | \_\_\_%             | \_\_\_%                        | -           |
| **Throughput**            | \_\_\_ req/s        | \_\_\_ req/s                   | \_\_\_%     |
| **Cache Hit Ratio**       | N/A                 | \_\_\_%                        | -           |
| **DB Connections (Peak)** | \_\_\_              | \_\_\_                         | -           |
| **Queue Wait (P95)**      | \_\_\_ ms           | \_\_\_ ms                      | \_\_\_%     |

### Load Capacity

| Concurrent Users | Status      | Notes                        |
| ---------------- | ----------- | ---------------------------- |
| 1,000            | ✅ Healthy  | No queue wait, low latency   |
| 5,000            | ✅ Healthy  | Minor queue wait (<200ms)    |
| 10,000           | ⚠️ Warning  | Queue wait approaching 500ms |
| 15,000           | ❌ Degraded | High error rate, timeouts    |

### Recommendations

Based on test results:

1. **Optimal Pool Size**: \_\_\_ connections (currently 20)
2. **Cache TTL**: Keep at 30-60s ✅ / Increase to **_ / Decrease to _**
3. **Redis Memory**: 512MB sufficient ✅ / Increase to \_\_\_
4. **Max Concurrent Users**: \_\_\_ before degradation
5. **Scaling Strategy**: Vertical (more DB resources) / Horizontal (more app instances)

---

## Tuning Based on Results

### High Queue Wait Times (>500ms)

**Symptom**: `pgbouncer_stats_avg_wait_time_seconds > 0.5`

**Solutions**:

```yaml
# docker-compose.yml
environment:
  - DEFAULT_POOL_SIZE=30 # Increase from 20
  - MAX_DB_CONNECTIONS=150 # Increase from 100
```

**Verify**:

```bash
docker-compose restart pgbouncer
# Re-run load test
k6 run tests/load/k6-full-stack.js
```

### Low Cache Hit Ratio (<60%)

**Symptom**: Cache hit ratio not improving after 5+ minutes

**Solutions**:

1. **Increase TTL**:

   ```typescript
   // src/chat-backend/services/chat.service.ts
   const ttl = offset === 0 ? 60 : 120; // Double the TTL
   ```

2. **Increase Redis Memory**:

   ```yaml
   # docker-compose.yml - redis service
   - "--maxmemory"
   - "1024mb" # Increase from 512mb
   ```

3. **Check Cache Key Patterns**:
   ```bash
   redis-cli KEYS "msg:history:*" | wc -l  # Count cached keys
   redis-cli INFO memory  # Check memory usage
   ```

### High Error Rates (>1%)

**Symptom**: `http_req_failed > 0.01`

**Investigate**:

```bash
# Application logs
tail -f /tmp/app-new.log | grep ERROR

# Database connection errors
docker logs chat-backend-db | grep -i error

# PgBouncer errors
docker logs chat-backend-pgbouncer | grep -i error
```

**Common Causes**:

- Database connection exhaustion
- Redis memory eviction issues
- Application timeouts

---

## Advanced Scenarios

### Test Cache Invalidation Impact

```javascript
// Modified k6 script: 50% writes (high invalidation)
if (scenario < 0.5) {
  getMessages();
} else {
  sendMessage(); // Invalidates cache more frequently
}
```

**Expected**: Higher cache miss ratio, but still better than baseline

### Test Cold Cache Start

```bash
# Flush Redis before test
redis-cli FLUSHALL

# Run load test immediately
k6 run tests/load/k6-full-stack.js
```

**Expected**: Low hit ratio initially, should improve to >60% within 2-3 minutes

### Test Database Failover

```bash
# Simulate database restart during load test
docker restart chat-backend-db

# Monitor PgBouncer connection recovery
docker logs chat-backend-pgbouncer -f
```

**Expected**: Brief error spike, automatic recovery via PgBouncer

---

## Continuous Load Testing

### CI/CD Integration

```yaml
# .github/workflows/load-test.yml
name: Load Test

on:
  schedule:
    - cron: "0 2 * * *" # Daily at 2 AM

jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Start services
        run: docker-compose up -d
      - name: Install k6
        run: |
          sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 \
            --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D00
          echo "deb https://dl.k6.io/deb stable main" | \
            sudo tee /etc/apt/sources.list.d/k6.list
          sudo apt-get update
          sudo apt-get install k6
      - name: Run load test
        run: k6 run tests/load/k6-full-stack.js
      - name: Upload results
        uses: actions/upload-artifact@v2
        with:
          name: load-test-results
          path: results/
```

---

## Troubleshooting

### k6 Connection Errors

```
ERRO[0023] GoError: Get "http://localhost:3001": dial tcp: connect: connection refused
```

**Solution**: Ensure application is running and accessible

```bash
curl http://localhost:3001/api/v1/health
```

### High Memory Usage During Test

```bash
# Monitor system resources
docker stats

# Check if services are hitting limits
docker inspect chat-backend-db | grep Memory
```

### Test Data Cleanup

```bash
# Clear test messages after load test
PGPASSWORD=password psql -h localhost -p 5432 -U postgres -d chat_backend_db \
  -c "DELETE FROM \"Message\" WHERE content LIKE 'Load test message%';"

# Verify message count
PGPASSWORD=password psql -h localhost -p 5432 -U postgres -d chat_backend_db \
  -c "SELECT COUNT(*) FROM \"Message\";"
```

---

## Next Steps

1. ✅ Run baseline test (no cache)
2. ✅ Run full-stack test (with cache)
3. Compare results and calculate improvement
4. Document findings in performance report
5. Tune configuration based on results
6. Re-test to validate improvements

---

**Generated**: October 22, 2025  
**Status**: Ready for load testing execution
