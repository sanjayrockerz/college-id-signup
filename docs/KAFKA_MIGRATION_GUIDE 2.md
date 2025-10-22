# Phase 3: Kafka Migration Guide

## Overview

This document outlines the migration path from **Redis Streams** to **Apache Kafka** when the messaging system outgrows the current infrastructure. Redis Streams is ideal for low-latency, moderate-throughput scenarios (<50k msgs/sec), while Kafka excels at higher throughput, longer retention, and multi-datacenter replication.

---

## Migration Triggers

Migrate to Kafka when **any** of the following conditions are met:

### 1. Throughput Threshold Exceeded

- **Current Capacity**: Redis Streams ~50,000 msgs/sec (with 16 partitions)
- **Trigger**: Sustained throughput >40,000 msgs/sec (80% capacity)
- **Monitoring**: Check `rate(stream_enqueue_total[5m])` in Grafana

### 2. Retention Requirements Increase

- **Current Capacity**: Redis Streams ~7 days retention (limited by memory)
- **Trigger**: Business requirement for >7 days message history
- **Use Cases**: Compliance, audit logs, long-term analytics

### 3. Multi-Datacenter Replication Needed

- **Current Limitation**: Redis Streams requires manual replication scripts
- **Trigger**: Disaster recovery (DR) or multi-region deployment requirement
- **Kafka Advantage**: Built-in cross-datacenter replication (MirrorMaker 2)

### 4. Stream Size Per Partition Exceeds Limits

- **Current Capacity**: ~10GB per partition before memory pressure
- **Trigger**: Any partition exceeds 8GB (80% threshold)
- **Monitoring**: Check `XINFO STREAM` for stream length

### 5. Need for Advanced Stream Processing

- **Trigger**: Requirement for Kafka Streams, ksqlDB, or complex CEP
- **Use Cases**: Real-time aggregations, windowed joins, event-driven microservices

---

## Pre-Migration Preparation

### 1. Capacity Planning

**Estimate Kafka Requirements:**

```bash
# Calculate topic partitions
CURRENT_PARTITIONS=16
TARGET_THROUGHPUT=100000  # msgs/sec
KAFKA_PARTITION_THROUGHPUT=10000  # msgs/sec (conservative)
KAFKA_PARTITIONS=$(( TARGET_THROUGHPUT / KAFKA_PARTITION_THROUGHPUT ))
# Result: 10 partitions minimum, use 16 for consistency with Redis

# Calculate disk capacity
RETENTION_DAYS=30
AVG_MESSAGE_SIZE=2048  # bytes (including envelope + metadata)
DAILY_MESSAGES=$(( TARGET_THROUGHPUT * 86400 ))
RETENTION_GB=$(( DAILY_MESSAGES * AVG_MESSAGE_SIZE * RETENTION_DAYS / 1073741824 ))
REPLICATION_FACTOR=3
TOTAL_DISK_GB=$(( RETENTION_GB * REPLICATION_FACTOR ))
# Result: ~15TB total for 30-day retention at 100k msgs/sec
```

**Kafka Cluster Sizing:**

- **Brokers**: Minimum 3 (for replication factor 3)
- **ZooKeeper**: 3 nodes (or use KRaft mode in Kafka 3.3+)
- **CPU**: 8-16 cores per broker
- **Memory**: 32-64GB per broker (heap: 6-12GB, page cache: remaining)
- **Disk**: NVMe SSD recommended, 5-10TB per broker
- **Network**: 10Gbps minimum

### 2. Schema Evolution

**Update Message Envelope for Kafka:**

```typescript
// Add Kafka-specific fields to MessageEnvelope
interface MessageEnvelope {
  // ... existing fields ...

  // Kafka metadata
  kafkaTopic?: string; // Topic name (e.g., "messages.v1")
  kafkaPartition?: number; // Partition assigned by Kafka
  kafkaOffset?: string; // Offset within partition
  kafkaTimestamp?: number; // Broker timestamp (ms since epoch)
  kafkaHeaders?: Record<string, string>; // Custom headers
}
```

### 3. Dual-Write Infrastructure

**Implement dual-write to both Redis and Kafka:**

```typescript
@Injectable()
export class DualWriteService {
  async enqueue(envelope: MessageEnvelope): Promise<void> {
    // Write to Redis (primary)
    const redisStreamId = await this.redisStreams.enqueue(envelope);

    // Write to Kafka (shadow traffic)
    try {
      const kafkaOffset = await this.kafkaProducer.send({
        topic: "messages.v1",
        key: envelope.conversationId,
        value: JSON.stringify(envelope),
        headers: {
          "correlation-id": envelope.correlationId,
          "idempotency-key": envelope.idempotencyKey,
        },
      });

      this.logger.debug(
        `Dual-write: Redis=${redisStreamId}, Kafka=${kafkaOffset}`,
      );
    } catch (error) {
      // Non-fatal: Kafka is shadow traffic during migration
      this.logger.warn("Kafka dual-write failed (non-blocking):", error);
    }
  }
}
```

---

## Migration Strategy

### Phase 1: Shadow Traffic (2-4 weeks)

**Goal**: Validate Kafka setup without affecting production traffic.

**Steps:**

1. **Deploy Kafka Cluster**
   - Provision brokers, ZooKeeper/KRaft
   - Create topics with matching partition count (16 partitions)
   - Configure retention (e.g., 30 days)

2. **Enable Dual-Write**
   - Deploy `DualWriteService` with Redis as primary
   - Kafka writes are best-effort (non-blocking)
   - Monitor Kafka lag: should be near-zero

3. **Validate Data Consistency**
   - Compare Redis vs Kafka message counts
   - Spot-check message content for accuracy
   - Verify partitioning (same conversationId → same partition)

4. **Load Testing**
   - Run load tests with dual-write enabled
   - Measure latency impact (should be <5ms p95)
   - Verify Kafka handles target throughput

**Success Criteria:**

- ✅ Kafka lag <100 messages for 7 days
- ✅ Message parity >99.9%
- ✅ Dual-write latency <5ms p95
- ✅ Zero Kafka-related incidents

### Phase 2: Consumer Migration (2-3 weeks)

**Goal**: Shift read traffic from Redis to Kafka.

**Steps:**

1. **Deploy Kafka Consumers**
   - Create consumer groups (e.g., `persistence-workers-kafka`)
   - Implement offset management (auto-commit or manual)
   - Mirror Redis consumer logic (idempotent persistence, ACK, DLQ)

2. **Canary Rollout**
   - Route 5% of partitions to Kafka consumers
   - Monitor for errors, lag, duplicate processing
   - Gradually increase to 25%, 50%, 100%

3. **Dual-Read Period**
   - Run both Redis and Kafka consumers simultaneously
   - Redis consumers process 100% (primary)
   - Kafka consumers process 100% (shadow)
   - Verify idempotency: duplicates should be no-ops

4. **Cutover to Kafka**
   - Switch primary to Kafka consumers
   - Keep Redis consumers as fallback (standby)

**Success Criteria:**

- ✅ Kafka consumer lag <500 messages
- ✅ Zero duplicate persisted messages (idempotency working)
- ✅ Processing throughput matches Redis baseline
- ✅ No DLQ spike (error rate <0.1%)

### Phase 3: Ingress Cutover (1 week)

**Goal**: Make Kafka the primary ingress path.

**Steps:**

1. **Feature Flag Rollout**
   - Introduce `USE_KAFKA_INGRESS` flag (default: false)
   - Enable for 10%, 25%, 50%, 100% of traffic

2. **Monitor Closely**
   - Watch for enqueue latency spikes
   - Verify idempotency still works (duplicate detection)
   - Check producer errors (retries, timeouts)

3. **Decommission Redis Ingress**
   - Stop dual-write after 7 days of stable Kafka ingress
   - Archive Redis streams for audit (optional)
   - Remove Redis ingress code

**Success Criteria:**

- ✅ Kafka producer latency <10ms p95
- ✅ Producer error rate <0.01%
- ✅ Idempotent hit rate unchanged (telemetry confirms)
- ✅ End-to-end latency within SLA (<100ms p95)

### Phase 4: Cleanup (1 week)

**Goal**: Remove Redis Streams infrastructure.

**Steps:**

1. **Stop Redis Consumers**
   - Graceful shutdown after Kafka consumers are stable
   - Ensure all pending messages processed

2. **Archive Historical Data**
   - Export Redis stream data to cold storage (S3)
   - Keep for compliance/audit (e.g., 90 days)

3. **Decommission Redis**
   - Remove Redis Streams deployment
   - Update monitoring dashboards (remove Redis metrics)
   - Archive runbooks

**Success Criteria:**

- ✅ All historical data exported
- ✅ Redis infrastructure decommissioned
- ✅ Monitoring dashboards updated
- ✅ Runbooks reflect Kafka-only architecture

---

## Partition Mapping

**Redis Streams → Kafka Topics:**

| Redis Stream                     | Kafka Topic       | Partitions | Retention |
| -------------------------------- | ----------------- | ---------- | --------- |
| `msg:stream:0` - `msg:stream:15` | `messages.v1`     | 16         | 30 days   |
| `msg:dlq`                        | `messages.dlq.v1` | 4          | 90 days   |

**Partition Key:**

- **Redis**: Hash of `conversationId` (murmur3)
- **Kafka**: Same hash algorithm, ensure consistency

```typescript
// Ensure same partition assignment
function getKafkaPartition(
  conversationId: string,
  totalPartitions: number,
): number {
  const hash = murmur3(conversationId);
  return Math.abs(hash) % totalPartitions;
}
```

---

## Consumer Group Migration

**Redis Consumer Groups → Kafka Consumer Groups:**

| Redis Group           | Kafka Group                 | Purpose                   |
| --------------------- | --------------------------- | ------------------------- |
| `persistence-workers` | `persistence-workers-kafka` | Persist messages to DB    |
| `dlq-processors`      | `dlq-processors-kafka`      | Process dead letter queue |

**Offset Management:**

- **Redis**: Track last processed stream ID per partition
- **Kafka**: Use Kafka offset commits (auto-commit or manual)
- **Migration**: Start Kafka consumers from `latest` (skip historical messages)

---

## Rollback Procedures

### Scenario 1: Kafka Ingress Failure

**Symptoms:**

- Producer errors spike >1%
- Enqueue latency >50ms p95
- Messages not appearing in Kafka

**Rollback:**

1. Disable `USE_KAFKA_INGRESS` feature flag (immediate)
2. Traffic reverts to Redis Streams ingress
3. Investigate Kafka issue (broker down, network partition)
4. Fix and re-enable gradually

**Recovery Time**: <5 minutes

### Scenario 2: Kafka Consumer Lag Explosion

**Symptoms:**

- Consumer lag >10,000 messages
- Persistence throughput drops <50% baseline
- DLQ messages spike

**Rollback:**

1. Re-enable Redis consumers (standby → active)
2. Scale Redis consumers to handle load
3. Investigate Kafka consumer issue (OOM, slow queries)
4. Fix Kafka consumers, then switch back

**Recovery Time**: 10-30 minutes

### Scenario 3: Data Inconsistency Detected

**Symptoms:**

- Message counts diverge between Redis and Kafka
- Duplicate messages despite idempotency
- Missing messages in DB

**Rollback:**

1. **STOP** Kafka consumers immediately
2. Revert to Redis-only path (ingress + consumers)
3. Audit data integrity (compare Redis vs DB)
4. Root cause analysis before retrying migration

**Recovery Time**: 1-4 hours

---

## Monitoring & Alerts

**Kafka-Specific Metrics:**

| Metric                          | Alert Threshold | Action                              |
| ------------------------------- | --------------- | ----------------------------------- |
| **Producer Latency (p95)**      | >50ms           | Investigate broker performance      |
| **Producer Error Rate**         | >0.1%           | Check broker logs, network          |
| **Consumer Lag**                | >5,000 messages | Scale consumers or optimize         |
| **Replication Lag**             | >10 seconds     | Check broker health, network        |
| **Disk Usage**                  | >80%            | Expand storage or reduce retention  |
| **Under-Replicated Partitions** | >0              | Critical: check broker availability |

**Grafana Dashboard Updates:**

- Replace Redis metrics with Kafka metrics
- Add producer latency, consumer lag, replication lag panels
- Keep DLQ metrics (consistent across both systems)

**Prometheus Alerts:**

```yaml
- alert: KafkaConsumerLagHigh
  expr: kafka_consumergroup_lag{group="persistence-workers-kafka"} > 5000
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Kafka consumer lag high: {{ $value }} messages"

- alert: KafkaProducerErrorRateHigh
  expr: rate(kafka_producer_errors_total[5m]) > 0.001
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "Kafka producer error rate: {{ $value }}/sec"
```

---

## Kafka Best Practices

### 1. Topic Configuration

```bash
kafka-topics --create \
  --topic messages.v1 \
  --partitions 16 \
  --replication-factor 3 \
  --config retention.ms=2592000000 \  # 30 days
  --config compression.type=lz4 \
  --config min.insync.replicas=2 \    # Durability
  --config max.message.bytes=1048576  # 1MB max
```

### 2. Producer Configuration

```typescript
const producer = kafka.producer({
  idempotent: true, // Exactly-once semantics
  maxInFlightRequests: 5,
  compression: CompressionTypes.LZ4,
  acks: -1, // Wait for all in-sync replicas
  retries: 3,
  retry: {
    retries: 3,
    initialRetryTime: 300,
    multiplier: 2,
  },
});
```

### 3. Consumer Configuration

```typescript
const consumer = kafka.consumer({
  groupId: "persistence-workers-kafka",
  sessionTimeout: 30000,
  heartbeatInterval: 3000,
  maxPollInterval: 300000, // 5 minutes
  autoCommit: false, // Manual commit for at-least-once
});

// Process batch and commit offsets
await consumer.run({
  eachBatch: async ({
    batch,
    resolveOffset,
    heartbeat,
    commitOffsetsIfNecessary,
  }) => {
    for (const message of batch.messages) {
      await processMessage(message);
      resolveOffset(message.offset);
      await heartbeat();
    }
    await commitOffsetsIfNecessary();
  },
});
```

### 4. Partition Rebalancing

- Use **cooperative sticky assignor** for minimal disruption
- Enable **incremental rebalancing** (Kafka 2.4+)
- Monitor consumer restarts during rebalance

### 5. Security

- **Encryption in Transit**: TLS/SSL for producer-broker, consumer-broker
- **Encryption at Rest**: OS-level disk encryption
- **Authentication**: SASL/SCRAM or mTLS
- **Authorization**: Kafka ACLs (topic-level permissions)

---

## Cost Comparison

**Redis Streams (Current):**

- **Infrastructure**: 3x r6g.2xlarge (8 vCPU, 64GB RAM) = ~$1,200/month
- **Data Transfer**: Minimal (intra-VPC)
- **Total**: ~$1,500/month

**Kafka (Post-Migration):**

- **Brokers**: 3x r6i.4xlarge (16 vCPU, 128GB RAM, 2TB NVMe) = ~$3,600/month
- **ZooKeeper**: 3x t3.medium = ~$100/month (or use KRaft)
- **Data Transfer**: Inter-AZ replication ~$200/month
- **Monitoring**: Confluent Control Center or Datadog Kafka = ~$300/month
- **Total**: ~$4,200/month

**Cost Increase**: +180% ($2,700/month)

**Justification**:

- Supports 2x throughput (100k msgs/sec vs 50k)
- 4x retention (30 days vs 7 days)
- Multi-datacenter replication capability
- Advanced stream processing (Kafka Streams)

---

## Timeline Summary

| Phase                           | Duration       | Effort (Engineer-Days)                      |
| ------------------------------- | -------------- | ------------------------------------------- |
| **Pre-Migration**               | 1 week         | 10 days (capacity planning, schema updates) |
| **Phase 1: Shadow Traffic**     | 2-4 weeks      | 15 days (Kafka deployment, dual-write)      |
| **Phase 2: Consumer Migration** | 2-3 weeks      | 20 days (consumer implementation, canary)   |
| **Phase 3: Ingress Cutover**    | 1 week         | 5 days (feature flag rollout)               |
| **Phase 4: Cleanup**            | 1 week         | 5 days (decommission Redis)                 |
| **Total**                       | **7-10 weeks** | **55 engineer-days**                        |

---

## Success Metrics

**Pre-Migration Baseline:**

- Enqueue throughput: 40,000 msgs/sec (sustained)
- End-to-end latency (p95): 85ms
- Consumer lag: <100 messages
- Idempotent hit rate: 2% (normal)

**Post-Migration Target:**

- Enqueue throughput: 100,000 msgs/sec (capacity)
- End-to-end latency (p95): <100ms (within SLA)
- Consumer lag: <500 messages
- Idempotent hit rate: 2% (unchanged)
- Zero data loss or corruption

---

## References

- [Apache Kafka Documentation](https://kafka.apache.org/documentation/)
- [Kafka Streams](https://kafka.apache.org/documentation/streams/)
- [MirrorMaker 2 (Cross-DC Replication)](https://cwiki.apache.org/confluence/display/KAFKA/KIP-382%3A+MirrorMaker+2.0)
- [KRaft Mode (ZooKeeper Removal)](https://kafka.apache.org/documentation/#kraft)
- [Confluent Best Practices](https://docs.confluent.io/platform/current/kafka/deployment.html)
