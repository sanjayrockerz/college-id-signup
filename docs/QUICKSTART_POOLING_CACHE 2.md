# Quick Start: Connection Pooling & Caching

**Objective**: Get PgBouncer and Redis running in 5 minutes

---

## Prerequisites

- Docker Desktop running
- Node.js dependencies installed (`npm install`)
- PostgreSQL data initialized

---

## Step 1: Start Infrastructure (2 min)

```bash
cd /Users/harishraghave/Desktop/colleging/college-id-signup-1

# Start Docker Desktop if not running
open -a Docker

# Wait for Docker to start (~30s)

# Start PostgreSQL, Redis, and PgBouncer
docker-compose up -d postgres redis pgbouncer

# Verify services are healthy
docker-compose ps
```

**Expected Output**:
```
NAME       SERVICE     STATUS    PORTS
postgres   postgres    running   0.0.0.0:5432->5432/tcp
redis      redis       running   0.0.0.0:6379->6379/tcp
pgbouncer  pgbouncer   running   0.0.0.0:6432->6432/tcp
```

---

## Step 2: Test PgBouncer Connection (1 min)

```bash
# Test client connection (port 6432)
psql -h localhost -p 6432 -U postgres -d chat_dev -c "SELECT 1 as test;"

# Check pool status (admin port 5432)
psql -h localhost -p 5432 -U pgbouncer_admin -d pgbouncer -c "SHOW POOLS;"
```

**Expected Output** (SHOW POOLS):
```
 database  | user     | cl_active | cl_waiting | sv_active | sv_idle | sv_used | maxwait
-----------+----------+-----------+------------+-----------+---------+---------+---------
 chat_dev  | postgres | 0         | 0          | 0         | 1       | 1       | 0
```

**What This Means**:
- `cl_active`: Active client connections (0 = idle)
- `cl_waiting`: Clients waiting in queue (should be 0 normally)
- `sv_active`: Active backend connections to PostgreSQL
- `sv_idle`: Idle backend connections ready for reuse
- `maxwait`: Maximum time (seconds) clients waited in queue

---

## Step 3: Test Redis Connection (1 min)

```bash
# Test Redis ping
docker-compose exec redis redis-cli ping
# Expected: PONG

# Test basic operations
docker-compose exec redis redis-cli <<EOF
SET test:key "hello world"
GET test:key
DEL test:key
EOF
```

**Expected Output**:
```
OK
"hello world"
(integer) 1
```

---

## Step 4: Update Application Configuration (1 min)

### Option A: Use PgBouncer (Recommended for Testing)

```bash
# Update your .env file
cat >> .env <<EOF

# Connection Pooling & Caching (Phase 3)
DATABASE_URL="postgresql://postgres:postgres@localhost:6432/chat_dev?pgbouncer=true"
DATABASE_URL_DIRECT="postgresql://postgres:postgres@localhost:5432/chat_dev"
ENABLE_REDIS_CACHE=true
CACHE_BYPASS=false
REDIS_URL="redis://localhost:6379"
EOF
```

### Option B: Keep Direct Connection (Rollback if Issues)

```bash
# Keep existing DATABASE_URL pointing to port 5432
# Just add Redis cache settings
cat >> .env <<EOF

# Redis Caching
ENABLE_REDIS_CACHE=true
CACHE_BYPASS=false
REDIS_URL="redis://localhost:6379"
EOF
```

---

## Step 5: Verify Cache Service (Optional)

Create a test file to verify the cache service works:

```typescript
// test-cache.ts
import { CacheService } from './src/common/services/cache.service';

async function testCache() {
  const cache = new CacheService();
  
  // Wait for Redis connection
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test health
  const healthy = await cache.healthCheck();
  console.log('Redis healthy:', healthy);
  
  // Test set/get
  await cache.set('test:key', { message: 'Hello from cache!' }, 60);
  const value = await cache.get('test:key');
  console.log('Cached value:', value);
  
  // Test metrics
  const metrics = cache.getMetrics();
  console.log('Cache metrics:', metrics);
  
  process.exit(0);
}

testCache().catch(console.error);
```

Run the test:
```bash
npx ts-node test-cache.ts
```

---

## Common Commands

### View Logs

```bash
# All services
docker-compose logs -f

# PgBouncer only
docker-compose logs -f pgbouncer

# Redis only
docker-compose logs -f redis

# PostgreSQL only
docker-compose logs -f postgres
```

### Check Pool Statistics

```bash
# Show current pool status
psql -h localhost -p 5432 -U pgbouncer_admin -d pgbouncer -c "SHOW POOLS;"

# Show transaction statistics
psql -h localhost -p 5432 -U pgbouncer_admin -d pgbouncer -c "SHOW STATS;"

# Show backend server status
psql -h localhost -p 5432 -U pgbouncer_admin -d pgbouncer -c "SHOW SERVERS;"

# Show database configuration
psql -h localhost -p 5432 -U pgbouncer_admin -d pgbouncer -c "SHOW DATABASES;"
```

### Check Redis Status

```bash
# Memory usage
docker-compose exec redis redis-cli INFO memory | grep used_memory_human

# Hit/miss ratio
docker-compose exec redis redis-cli INFO stats | grep keyspace

# All keys (be careful in production!)
docker-compose exec redis redis-cli KEYS '*'

# Specific pattern
docker-compose exec redis redis-cli KEYS 'msg:history:*'
```

### Stop Services

```bash
# Stop all services
docker-compose down

# Stop and remove volumes (CAUTION: deletes data)
docker-compose down -v

# Stop specific service
docker-compose stop pgbouncer
docker-compose stop redis
```

---

## Monitoring with Prometheus & Grafana (Optional)

Start the monitoring stack:

```bash
# Start all services including monitoring
docker-compose --profile monitoring up -d

# Access Grafana
open http://localhost:3001
# Login: admin / admin (change on first login)

# Access Prometheus
open http://localhost:9090
```

---

## Troubleshooting

### PgBouncer Issues

**Problem**: `connection refused` on port 6432
```bash
# Check if PgBouncer is running
docker-compose ps pgbouncer

# Check logs
docker-compose logs pgbouncer

# Restart
docker-compose restart pgbouncer
```

**Problem**: `authentication failed`
```bash
# Test direct PostgreSQL connection first
psql -h localhost -p 5432 -U postgres -d chat_dev

# If that works, check userlist.txt has correct users
cat config/pgbouncer/userlist.txt

# Restart PgBouncer to reload config
docker-compose restart pgbouncer
```

**Problem**: Queries timing out
```bash
# Check queue wait times
psql -h localhost -p 5432 -U pgbouncer_admin -d pgbouncer -c "SHOW POOLS;"

# If cl_waiting > 0 and maxwait > 10s:
# Option 1: Increase pool size (edit config/pgbouncer/pgbouncer.ini)
# Option 2: Switch to direct connection (use DATABASE_URL_DIRECT)
```

### Redis Issues

**Problem**: `connection refused` on port 6379
```bash
# Check if Redis is running
docker-compose ps redis

# Check logs
docker-compose logs redis

# Restart
docker-compose restart redis
```

**Problem**: Out of memory errors
```bash
# Check memory usage
docker-compose exec redis redis-cli INFO memory

# Solution 1: Increase maxmemory in docker-compose.yml
# Solution 2: Enable cache bypass temporarily
export CACHE_BYPASS=true

# Solution 3: Manually flush cache
docker-compose exec redis redis-cli FLUSHALL
```

**Problem**: Cache service not connecting from app
```bash
# Verify REDIS_URL is set correctly
echo $REDIS_URL

# Test connection from app container
# (if running in Docker)
docker-compose exec app redis-cli -u $REDIS_URL ping
```

### Docker Issues

**Problem**: `Cannot connect to Docker daemon`
```bash
# Start Docker Desktop
open -a Docker

# Wait ~30 seconds for Docker to fully start

# Verify Docker is running
docker ps
```

**Problem**: Port already in use
```bash
# Check what's using the port (e.g., 6432)
lsof -i :6432

# Kill the process or change port in docker-compose.yml
# Example: Change "6432:6432" to "6433:6432"
```

---

## Performance Validation

### Test Connection Pooling

```bash
# Run concurrent connections (requires pgbench)
pgbench -h localhost -p 6432 -U postgres -d chat_dev \
  -c 100 -j 10 -T 60 -P 5 -n -f -

# Watch pool status while test runs (in another terminal)
watch -n 1 'psql -h localhost -p 5432 -U pgbouncer_admin -d pgbouncer -c "SHOW POOLS;"'
```

**What to Look For**:
- `cl_active` should increase (clients connecting)
- `cl_waiting` should stay low (<10% of cl_active)
- `sv_active` should stay ≤ pool_size (20 by default)
- `maxwait` should stay <1 second

### Test Cache Performance

```bash
# Run load test with cache metrics endpoint
# (implement /api/cache/metrics in your app)

# Before cache
ab -n 10000 -c 100 http://localhost:3000/api/messages/history/123

# Enable cache
export ENABLE_REDIS_CACHE=true

# After cache
ab -n 10000 -c 100 http://localhost:3000/api/messages/history/123

# Check cache metrics
curl http://localhost:3000/api/cache/metrics
```

**Expected Improvement**:
- Response time: 30-50% faster
- Database queries: 60-80% reduction
- Cache hit ratio: >60% after warmup

---

## Next Steps

1. ✅ Infrastructure running (you are here)
2. ⏳ Integrate cache with message history endpoints
3. ⏳ Update Prisma to use PgBouncer
4. ⏳ Setup monitoring dashboards
5. ⏳ Run load tests at scale (5k-10k connections)
6. ⏳ Measure and document performance improvements

See `docs/PHASE3_INFRASTRUCTURE_SETUP.md` for complete implementation details.

---

**Status**: Infrastructure Ready ✅  
**Time to Complete**: ~5 minutes  
**Next**: Application Integration
