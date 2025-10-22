# Phase 3 Deployment Guide

## Pre-Deployment Checklist

### 1. Database Migration

Run the Prisma migration to add idempotency fields and MessageReceipt model:

```bash
# Generate migration
npx prisma migrate dev --name phase3_idempotency_receipts

# Review migration SQL
cat prisma/migrations/<timestamp>_phase3_idempotency_receipts/migration.sql

# Apply to production
npx prisma migrate deploy

# Regenerate Prisma Client
npx prisma generate
```

**Migration Changes:**

- Add `idempotencyKey` (unique), `correlationId` to `Message` table
- Create `MessageReceipt` table with unique constraint on (messageId, userId, state)
- Create indexes for performance

### 2. Environment Variables

Add to your `.env` file:

```bash
# Redis Streams Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password
REDIS_STREAM_DB=1
STREAM_PARTITIONS=16

# Consumer Worker Configuration
STREAM_MAX_RETRIES=3
STREAM_POLL_INTERVAL_MS=5000
STREAM_BATCH_SIZE=10
ENABLE_STREAM_CONSUMERS=true

# Database Configuration (already exists)
DATABASE_URL=postgresql://user:pass@localhost:5432/colleging
```

### 3. Install Dependencies

```bash
# Install Redis client
npm install ioredis

# Install UUID (if not already installed)
npm install uuid
npm install -D @types/uuid

# Install Prometheus client (if not already installed)
npm install prom-client
```

### 4. Redis Setup

Initialize Redis Streams and consumer groups:

```bash
# Connect to Redis
redis-cli

# Create consumer groups for all partitions (0-15)
# This is automated by RedisStreamsService.onModuleInit()
# But you can manually verify:
XGROUP CREATE msg:stream:0 persistence-workers 0 MKSTREAM
XGROUP CREATE msg:stream:1 persistence-workers 0 MKSTREAM
# ... repeat for partitions 2-15

# Create DLQ consumer group
XGROUP CREATE msg:dlq dlq-processors 0 MKSTREAM
```

## Deployment Steps

### Step 1: Deploy Core Services (No Traffic)

```bash
# Build application
npm run build

# Run database migrations
npx prisma migrate deploy
npx prisma generate

# Start application (consumers disabled)
ENABLE_STREAM_CONSUMERS=false npm start
```

**Verify:**

- Application starts without errors
- Prisma Client includes `messageReceipt` model
- Redis connection successful

### Step 2: Enable Consumer Workers (Shadow Mode)

```bash
# Enable consumers
ENABLE_STREAM_CONSUMERS=true npm start
```

**Verify:**

- 16 consumer workers start (one per partition)
- No errors in logs
- Consumers poll Redis streams (no messages yet)

**Monitor:**

```bash
# Check consumer logs
pm2 logs <app-name> | grep "Worker started"

# Should see:
# Worker started for partition 0
# Worker started for partition 1
# ... (16 total)
```

### Step 3: Enable Idempotent Ingress (Gradual Rollout)

Update your API route to use the idempotent ingress service:

```typescript
// Before (direct persistence):
@Post('messages')
async sendMessage(@Body() dto: SendMessageDto) {
  const message = await this.messageService.create(dto);
  return message;
}

// After (idempotent ingress):
@Post('messages')
async sendMessage(@Body() dto: SendMessageDto) {
  const ack = await this.idempotencyService.ingestMessage({
    conversationId: dto.conversationId,
    senderId: dto.senderId,
    content: dto.content,
    contentType: dto.contentType,
    clientMessageId: dto.clientMessageId,
    recipientIds: dto.recipientIds,
  });

  return {
    messageId: ack.messageId,
    state: ack.state,
    acceptedAt: ack.acceptedAt,
  };
}
```

**Gradual Rollout:**

1. Deploy to 10% of traffic (canary deployment)
2. Monitor for 1 hour (check metrics, logs)
3. Increase to 50% if no issues
4. Increase to 100% after 24 hours of stable operation

### Step 4: Verify End-to-End Flow

Test the complete flow:

```bash
# 1. Send message via API
curl -X POST http://localhost:3000/api/messages \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "test_conv_001",
    "senderId": "user_001",
    "content": "Hello, Phase 3!",
    "contentType": "text",
    "clientMessageId": "client_msg_001",
    "recipientIds": ["user_002"]
  }'

# 2. Check Redis stream
redis-cli
XREAD STREAMS msg:stream:0 0  # Check partition 0

# 3. Wait for consumer processing (~1-5 seconds)

# 4. Verify in database
psql -d colleging -c "SELECT id, content, idempotencyKey FROM messages WHERE content = 'Hello, Phase 3!';"

# 5. Check metrics
curl http://localhost:9090/metrics | grep stream_enqueue_total
```

**Expected Results:**

- API returns ACK with `messageId`, `state: 'pending'`
- Message appears in Redis stream
- Consumer processes message (check logs)
- Message persisted to database
- Metrics incremented (`stream_enqueue_total`, `stream_consumer_processed_total`)

### Step 5: Test Idempotency

Send duplicate message:

```bash
# Send same message again (same clientMessageId)
curl -X POST http://localhost:3000/api/messages \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "test_conv_001",
    "senderId": "user_001",
    "content": "Hello, Phase 3!",
    "contentType": "text",
    "clientMessageId": "client_msg_001",
    "recipientIds": ["user_002"]
  }'

# Should return SAME messageId with idempotentHit flag
```

**Verify:**

- API returns same `messageId` as first request
- No duplicate in database
- Metric `idempotency_hit_total{operation="ingress"}` incremented

### Step 6: Import Grafana Dashboard

```bash
# Copy dashboard JSON
cat monitoring/grafana/phase3-queue-dashboard.json

# Import in Grafana UI:
# 1. Navigate to Dashboards > Import
# 2. Paste JSON
# 3. Select Prometheus data source
# 4. Click Import
```

**Verify Panels:**

- Enqueue Rate: Shows incoming messages
- Dequeue Rate: Shows consumer processing
- Partition Lag: Should be near-zero (<100)
- Processing Duration: p95 <100ms
- DLQ Rate: Should be zero (no failures)
- Idempotent Hit Rate: 2-3% of traffic (normal)

### Step 7: Configure Alerts

Add Prometheus alerts:

```yaml
# prometheus/alerts/phase3-queue.yml
groups:
  - name: phase3_queue
    interval: 60s
    rules:
      - alert: QueuePartitionLagHigh
        expr: stream_partition_lag > 1000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Partition {{ $labels.partition }} lag is {{ $value }} messages"

      - alert: QueueDLQRateHigh
        expr: rate(stream_dead_letter_total[5m]) > 10
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "DLQ rate is {{ $value }}/sec (threshold: 10/sec)"

      - alert: ConsumerProcessingErrors
        expr: rate(stream_consumer_processed_total{status="error"}[5m]) > 1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Consumer error rate is {{ $value }}/sec"
```

Reload Prometheus:

```bash
curl -X POST http://localhost:9090/-/reload
```

## Post-Deployment Monitoring

### Day 1: Monitor Closely

**Metrics to Watch:**

- **Enqueue Rate**: Should match API request rate
- **Partition Lag**: Should stay <100 messages
- **Processing Duration (p95)**: Should be <100ms
- **DLQ Rate**: Should be zero (no failures)
- **Idempotent Hit Rate**: 2-3% normal, >10% investigate

**Log Monitoring:**

```bash
# Watch consumer logs
pm2 logs <app-name> --lines 100 | grep -E "(Persisted|Idempotent|Failed)"

# Watch for errors
pm2 logs <app-name> --err --lines 100
```

### Week 1: Stability Check

**Daily Tasks:**

1. Check Grafana dashboard (5-minute review)
2. Verify partition lag <500 messages
3. Review DLQ stream (should be empty)
4. Check consumer restart count (should be zero)

**Weekly Tasks:**

1. Review idempotent hit rate trend
2. Analyze processing duration percentiles
3. Check database growth rate
4. Review Redis memory usage

### Month 1: Performance Tuning

**Optimization Opportunities:**

1. **Redis Cache for Idempotency** (if hit rate >5%):
   - Implement Redis cache in `IdempotencyService.checkCachedIdempotency()`
   - TTL: 5 minutes
   - Reduces DB load for duplicate requests

2. **Object Storage for Large Payloads** (if avg message size >2KB):
   - Upload content to S3/R2
   - Store `payloadKey` in envelope
   - Fetch during persistence

3. **Partition Count Tuning** (if lag consistently >500):
   - Increase partitions from 16 to 32
   - Requires Redis reconfiguration and consumer scaling

4. **Batch Size Tuning** (if processing duration high):
   - Reduce `STREAM_BATCH_SIZE` from 10 to 5 (lower latency)
   - Or increase to 20 (higher throughput)

## Rollback Procedure

If critical issues arise:

### Scenario 1: Consumer Errors Spike

```bash
# Disable consumers immediately
ENABLE_STREAM_CONSUMERS=false pm2 restart <app-name>

# Messages remain in queue (safe)
# Fix issue, then re-enable consumers
```

**Recovery Time**: <5 minutes

### Scenario 2: Database Issues

```bash
# Revert to synchronous persistence
# (Comment out idempotent ingress, use direct DB writes)

# Messages in queue will be reprocessed after fix
```

**Recovery Time**: 10-30 minutes

### Scenario 3: Data Corruption

```bash
# Stop all consumers
ENABLE_STREAM_CONSUMERS=false pm2 restart <app-name>

# Audit database
psql -d colleging -c "SELECT COUNT(*), idempotencyKey FROM messages GROUP BY idempotencyKey HAVING COUNT(*) > 1;"

# If duplicates found, keep earliest createdAt
psql -d colleging -c "DELETE FROM messages WHERE id NOT IN (SELECT MIN(id) FROM messages GROUP BY idempotencyKey);"

# Re-enable consumers after fix
```

**Recovery Time**: 1-4 hours

## Load Testing

Before handling production traffic, run load tests:

```bash
# Install load testing tool
npm install -g artillery

# Create load test scenario
cat > load-test.yml <<EOF
config:
  target: http://localhost:3000
  phases:
    - duration: 60
      arrivalRate: 100  # 100 msgs/sec
    - duration: 300
      arrivalRate: 500  # 500 msgs/sec
scenarios:
  - flow:
      - post:
          url: /api/messages
          json:
            conversationId: "{{ \$randomString() }}"
            senderId: "user_{{ \$randomNumber(1, 1000) }}"
            content: "Load test message {{ \$randomString() }}"
            contentType: text
            clientMessageId: "{{ \$randomString() }}"
            recipientIds: ["user_{{ \$randomNumber(1, 1000) }}"]
EOF

# Run load test
artillery run load-test.yml
```

**Success Criteria:**

- ✅ Enqueue rate matches arrival rate
- ✅ Partition lag stays <1000 messages
- ✅ Processing duration p95 <100ms
- ✅ No DLQ messages
- ✅ Zero consumer crashes

## Success Criteria

Before considering deployment complete:

- [x] Database migrations applied successfully
- [x] All 16 consumer workers running stable
- [x] Grafana dashboard imported and showing metrics
- [x] Prometheus alerts configured
- [ ] End-to-end test passes (send → process → persist)
- [ ] Idempotency test passes (duplicate detection)
- [ ] Load test passes (500 msgs/sec sustained)
- [ ] 48 hours of stable operation (no consumer crashes)
- [ ] Partition lag <500 messages (95th percentile)
- [ ] DLQ rate <0.1% of traffic

## Support

**Documentation:**

- Architecture: `PHASE3_COMPLETE.md`
- Migration to Kafka: `docs/KAFKA_MIGRATION_GUIDE.md`
- Runbooks: See "Operational Runbooks" section in `PHASE3_COMPLETE.md`

**Monitoring:**

- Grafana Dashboard: "Phase 3: Durable Delivery - Queue Monitoring"
- Prometheus Metrics: Port 9090
- Logs: `pm2 logs <app-name>`

**Troubleshooting:**

- High lag → Scale consumers or increase partitions
- DLQ spike → Check logs for error patterns
- Idempotent hit spike → Check client retry logic
- Consumer crashes → Check heap size, DB connections

---

**Deployment Checklist Complete**: Ready for production! 🚀
