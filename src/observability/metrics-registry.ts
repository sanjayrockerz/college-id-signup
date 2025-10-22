import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";
import { getEnv } from "../config/environment";

export type MessageThroughputType = "send" | "history" | "delivered" | "read";
export type DeliveryLatencyEvent = "send" | "history";
export type TelemetryErrorEvent =
  | "handshake"
  | "send_message"
  | "history"
  | "delivery"
  | "read"
  | "internal";

export type ReplaySource = "cache" | "durable";
export type DedupeContext = "replay" | "live";

// Database metrics types
export type DbQueryType =
  | "select"
  | "insert"
  | "update"
  | "delete"
  | "transaction";
export type DbPoolStatus = "available" | "used" | "pending";
export type CacheOperation = "get" | "set" | "delete" | "invalidate";
export type CacheResult = "hit" | "miss" | "error";

type HandshakeResult = "accepted" | "rejected";

type MetricDescriptor = {
  readonly name: string;
  readonly labelNames: readonly string[];
};

const DEFAULT_METRIC_BUCKETS_MS = [
  5, 10, 25, 50, 75, 100, 150, 250, 500, 750, 1000,
] as const;

class TelemetryMetricsRegistry {
  private static instance: TelemetryMetricsRegistry | null = null;

  private readonly registry: Registry;
  private readonly metricDescriptors: MetricDescriptor[] = [];

  private environmentLabel: string;
  private instanceLabel: string;

  private readonly wsConnectionsGauge: Gauge<string>;
  private readonly messageThroughputCounter: Counter<string>;
  private readonly deliveryLatencyHistogram: Histogram<string>;
  private readonly errorCounter: Counter<string>;
  private readonly handshakeCounter: Counter<string>;
  private readonly adapterConnectCounter: Counter<string>;
  private readonly adapterErrorCounter: Counter<string>;
  private readonly adapterHeartbeatGauge: Gauge<string>;
  private readonly socketDisconnectCounter: Counter<string>;
  private readonly presenceWriteCounter: Counter<string>;
  private readonly heartbeatExtendCounter: Counter<string>;
  private readonly replayCounter: Counter<string>;
  private readonly dedupeCounter: Counter<string>;

  // Database connection pooling metrics
  private readonly dbConnectionsGauge: Gauge<string>;
  private readonly dbQueueWaitHistogram: Histogram<string>;
  private readonly dbTransactionDurationHistogram: Histogram<string>;
  private readonly dbQueryCounter: Counter<string>;
  private readonly dbPoolSaturationGauge: Gauge<string>;

  // Cache metrics
  private readonly cacheOperationCounter: Counter<string>;
  private readonly cacheHitRatioGauge: Gauge<string>;
  private readonly cacheLatencyHistogram: Histogram<string>;
  private readonly cacheEvictionCounter: Counter<string>;
  private readonly cacheSizeGauge: Gauge<string>;

  // Read replica metrics
  private readonly replicaLagGauge: Gauge<string>;
  private readonly replicaHealthGauge: Gauge<string>;
  private readonly replicaLagBytesGauge: Gauge<string>;
  private readonly readRoutingCounter: Counter<string>;

  // Vacuum health metrics
  private readonly tableDeadTuplesGauge: Gauge<string>;
  private readonly tableBloatRatioGauge: Gauge<string>;
  private readonly vacuumLagSecondsGauge: Gauge<string>;
  private readonly analyzeLagSecondsGauge: Gauge<string>;
  private readonly autovacuumRunningGauge: Gauge<string>;

  // Query performance metrics
  private readonly queryDurationHistogram: Histogram<string>;
  private readonly slowQueryCounter: Counter<string>;
  private readonly queryErrorCounter: Counter<string>;

  // PgBouncer metrics
  private readonly pgbouncerActiveConnectionsGauge: Gauge<string>;
  private readonly pgbouncerIdleConnectionsGauge: Gauge<string>;
  private readonly pgbouncerWaitingClientsGauge: Gauge<string>;
  private readonly pgbouncerPoolSaturationGauge: Gauge<string>;
  private readonly pgbouncerTransactionRateGauge: Gauge<string>;
  private readonly pgbouncerQueryRateGauge: Gauge<string>;
  private readonly pgbouncerAvgQueryTimeGauge: Gauge<string>;
  private readonly pgbouncerAvgWaitTimeGauge: Gauge<string>;

  private constructor() {
    this.registry = new Registry();
    collectDefaultMetrics({
      register: this.registry,
      prefix: "chat_backend_",
    });

    this.environmentLabel = this.resolveEnvironmentLabel();
    this.instanceLabel = this.resolveInstanceLabel();

    this.wsConnectionsGauge = new Gauge({
      name: "ws_connections",
      help: "Active WebSocket connections",
      labelNames: ["environment", "instance"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "ws_connections",
      labelNames: ["environment", "instance"],
    });

    this.messageThroughputCounter = new Counter({
      name: "message_throughput_total",
      help: "Total number of chat message operations processed",
      labelNames: ["environment", "instance", "type"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "message_throughput_total",
      labelNames: ["environment", "instance", "type"],
    });

    this.deliveryLatencyHistogram = new Histogram({
      name: "delivery_latency_ms",
      help: "Message delivery latency in milliseconds",
      labelNames: ["environment", "instance", "event"],
      buckets: [...DEFAULT_METRIC_BUCKETS_MS],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "delivery_latency_ms",
      labelNames: ["environment", "instance", "event"],
    });

    this.errorCounter = new Counter({
      name: "error_total",
      help: "Total number of chat errors encountered",
      labelNames: ["environment", "instance", "event"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "error_total",
      labelNames: ["environment", "instance", "event"],
    });

    this.handshakeCounter = new Counter({
      name: "handshake_total",
      help: "Total handshake attempts categorised by result",
      labelNames: ["environment", "instance", "event"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "handshake_total",
      labelNames: ["environment", "instance", "event"],
    });

    this.adapterConnectCounter = new Counter({
      name: "adapter_connect_total",
      help: "Redis adapter connection and readiness events",
      labelNames: ["environment", "instance", "event"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "adapter_connect_total",
      labelNames: ["environment", "instance", "event"],
    });

    this.adapterErrorCounter = new Counter({
      name: "adapter_error_total",
      help: "Redis adapter error events",
      labelNames: ["environment", "instance", "event"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "adapter_error_total",
      labelNames: ["environment", "instance", "event"],
    });

    this.adapterHeartbeatGauge = new Gauge({
      name: "adapter_last_heartbeat_ms",
      help: "Timestamp of the latest successful adapter heartbeat",
      labelNames: ["environment", "instance"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "adapter_last_heartbeat_ms",
      labelNames: ["environment", "instance"],
    });

    this.socketDisconnectCounter = new Counter({
      name: "socket_disconnect_total",
      help: "Socket disconnects grouped by normalised reason",
      labelNames: ["environment", "instance", "reason"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "socket_disconnect_total",
      labelNames: ["environment", "instance", "reason"],
    });

    this.presenceWriteCounter = new Counter({
      name: "registry_write_total",
      help: "Presence registry write operations",
      labelNames: ["environment", "instance", "event"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "registry_write_total",
      labelNames: ["environment", "instance", "event"],
    });

    this.heartbeatExtendCounter = new Counter({
      name: "heartbeat_extend_total",
      help: "Presence heartbeat extensions",
      labelNames: ["environment", "instance", "event"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "heartbeat_extend_total",
      labelNames: ["environment", "instance", "event"],
    });

    this.replayCounter = new Counter({
      name: "message_replay_total",
      help: "Messages replayed to clients",
      labelNames: ["environment", "instance", "source"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "message_replay_total",
      labelNames: ["environment", "instance", "source"],
    });

    this.dedupeCounter = new Counter({
      name: "delivery_dedupe_total",
      help: "Messages suppressed due to delivery deduplication",
      labelNames: ["environment", "instance", "context"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "delivery_dedupe_total",
      labelNames: ["environment", "instance", "context"],
    });

    // Database connection pooling metrics
    this.dbConnectionsGauge = new Gauge({
      name: "db_connections",
      help: "Current database connections by status (available, used, pending)",
      labelNames: ["environment", "instance", "pool", "status"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "db_connections",
      labelNames: ["environment", "instance", "pool", "status"],
    });

    this.dbQueueWaitHistogram = new Histogram({
      name: "db_tx_queue_wait_ms",
      help: "Time spent waiting in database connection queue (milliseconds)",
      labelNames: ["environment", "instance", "pool"],
      buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "db_tx_queue_wait_ms",
      labelNames: ["environment", "instance", "pool"],
    });

    this.dbTransactionDurationHistogram = new Histogram({
      name: "db_transaction_duration_ms",
      help: "Database transaction execution time (milliseconds)",
      labelNames: ["environment", "instance", "pool", "operation"],
      buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "db_transaction_duration_ms",
      labelNames: ["environment", "instance", "pool", "operation"],
    });

    this.dbQueryCounter = new Counter({
      name: "db_query_total",
      help: "Total database queries executed by type",
      labelNames: ["environment", "instance", "type", "status"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "db_query_total",
      labelNames: ["environment", "instance", "type", "status"],
    });

    this.dbPoolSaturationGauge = new Gauge({
      name: "db_pool_saturation_ratio",
      help: "Database connection pool saturation (0-1, where 1 = fully saturated)",
      labelNames: ["environment", "instance", "pool"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "db_pool_saturation_ratio",
      labelNames: ["environment", "instance", "pool"],
    });

    // Cache metrics
    this.cacheOperationCounter = new Counter({
      name: "cache_operation_total",
      help: "Total cache operations by type and result",
      labelNames: ["environment", "instance", "operation", "result", "entity"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "cache_operation_total",
      labelNames: ["environment", "instance", "operation", "result", "entity"],
    });

    this.cacheHitRatioGauge = new Gauge({
      name: "cache_hit_ratio",
      help: "Cache hit ratio (0-1) by entity type",
      labelNames: ["environment", "instance", "entity"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "cache_hit_ratio",
      labelNames: ["environment", "instance", "entity"],
    });

    this.cacheLatencyHistogram = new Histogram({
      name: "cache_latency_ms",
      help: "Cache operation latency (milliseconds)",
      labelNames: ["environment", "instance", "operation", "entity"],
      buckets: [0.5, 1, 2, 5, 10, 25, 50, 100],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "cache_latency_ms",
      labelNames: ["environment", "instance", "operation", "entity"],
    });

    this.cacheEvictionCounter = new Counter({
      name: "cache_eviction_total",
      help: "Total cache evictions (TTL expiry and explicit invalidation)",
      labelNames: ["environment", "instance", "entity", "reason"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "cache_eviction_total",
      labelNames: ["environment", "instance", "entity", "reason"],
    });

    this.cacheSizeGauge = new Gauge({
      name: "cache_size_bytes",
      help: "Current cache size in bytes by entity",
      labelNames: ["environment", "instance", "entity"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "cache_size_bytes",
      labelNames: ["environment", "instance", "entity"],
    });

    // Read replica metrics
    this.replicaLagGauge = new Gauge({
      name: "replica_lag_seconds",
      help: "Replication lag between primary and replica in seconds",
      labelNames: ["environment", "instance"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "replica_lag_seconds",
      labelNames: ["environment", "instance"],
    });

    this.replicaHealthGauge = new Gauge({
      name: "replica_health",
      help: "Replica health status (1=healthy, 0=unhealthy)",
      labelNames: ["environment", "instance"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "replica_health",
      labelNames: ["environment", "instance"],
    });

    this.replicaLagBytesGauge = new Gauge({
      name: "replica_lag_bytes",
      help: "Replication lag in bytes (LSN difference)",
      labelNames: ["environment", "instance"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "replica_lag_bytes",
      labelNames: ["environment", "instance"],
    });

    this.readRoutingCounter = new Counter({
      name: "read_routing_total",
      help: "Total read queries routed to primary or replica",
      labelNames: ["environment", "instance", "target", "endpoint"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "read_routing_total",
      labelNames: ["environment", "instance", "target", "endpoint"],
    });

    // Vacuum health metrics
    this.tableDeadTuplesGauge = new Gauge({
      name: "table_dead_tuples",
      help: "Number of dead tuples in table awaiting vacuum",
      labelNames: ["environment", "instance", "table", "schema"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "table_dead_tuples",
      labelNames: ["environment", "instance", "table", "schema"],
    });

    this.tableBloatRatioGauge = new Gauge({
      name: "table_bloat_ratio",
      help: "Estimated table bloat ratio (0-1)",
      labelNames: ["environment", "instance", "table", "schema"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "table_bloat_ratio",
      labelNames: ["environment", "instance", "table", "schema"],
    });

    this.vacuumLagSecondsGauge = new Gauge({
      name: "vacuum_lag_seconds",
      help: "Seconds since last vacuum or autovacuum",
      labelNames: ["environment", "instance", "table", "schema"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "vacuum_lag_seconds",
      labelNames: ["environment", "instance", "table", "schema"],
    });

    this.analyzeLagSecondsGauge = new Gauge({
      name: "analyze_lag_seconds",
      help: "Seconds since last analyze or autoanalyze",
      labelNames: ["environment", "instance", "table", "schema"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "analyze_lag_seconds",
      labelNames: ["environment", "instance", "table", "schema"],
    });

    this.autovacuumRunningGauge = new Gauge({
      name: "autovacuum_running",
      help: "Whether autovacuum is currently running on table (0/1)",
      labelNames: ["environment", "instance", "table", "schema"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "autovacuum_running",
      labelNames: ["environment", "instance", "table", "schema"],
    });

    // Query performance metrics
    this.queryDurationHistogram = new Histogram({
      name: "query_duration_ms",
      help: "Database query duration in milliseconds",
      labelNames: [
        "environment",
        "instance",
        "endpoint",
        "query_type",
        "model",
      ],
      buckets: [5, 10, 25, 50, 100, 200, 500, 1000, 2000, 5000],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "query_duration_ms",
      labelNames: [
        "environment",
        "instance",
        "endpoint",
        "query_type",
        "model",
      ],
    });

    this.slowQueryCounter = new Counter({
      name: "slow_query_total",
      help: "Total number of slow queries (>1000ms)",
      labelNames: ["environment", "instance", "endpoint", "model", "threshold"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "slow_query_total",
      labelNames: ["environment", "instance", "endpoint", "model", "threshold"],
    });

    this.queryErrorCounter = new Counter({
      name: "query_error_total",
      help: "Total number of query errors",
      labelNames: [
        "environment",
        "instance",
        "endpoint",
        "model",
        "error_type",
      ],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "query_error_total",
      labelNames: [
        "environment",
        "instance",
        "endpoint",
        "model",
        "error_type",
      ],
    });

    // PgBouncer metrics
    this.pgbouncerActiveConnectionsGauge = new Gauge({
      name: "pgbouncer_active_connections",
      help: "Number of active server connections in PgBouncer pool",
      labelNames: ["environment", "instance", "database", "pool_mode"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "pgbouncer_active_connections",
      labelNames: ["environment", "instance", "database", "pool_mode"],
    });

    this.pgbouncerIdleConnectionsGauge = new Gauge({
      name: "pgbouncer_idle_connections",
      help: "Number of idle server connections in PgBouncer pool",
      labelNames: ["environment", "instance", "database", "pool_mode"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "pgbouncer_idle_connections",
      labelNames: ["environment", "instance", "database", "pool_mode"],
    });

    this.pgbouncerWaitingClientsGauge = new Gauge({
      name: "pgbouncer_waiting_clients",
      help: "Number of clients waiting for a server connection",
      labelNames: ["environment", "instance", "database"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "pgbouncer_waiting_clients",
      labelNames: ["environment", "instance", "database"],
    });

    this.pgbouncerPoolSaturationGauge = new Gauge({
      name: "pgbouncer_pool_saturation",
      help: "Pool saturation ratio (active / total capacity)",
      labelNames: ["environment", "instance", "database"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "pgbouncer_pool_saturation",
      labelNames: ["environment", "instance", "database"],
    });

    this.pgbouncerTransactionRateGauge = new Gauge({
      name: "pgbouncer_transaction_rate",
      help: "Transactions per second through PgBouncer",
      labelNames: ["environment", "instance", "database"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "pgbouncer_transaction_rate",
      labelNames: ["environment", "instance", "database"],
    });

    this.pgbouncerQueryRateGauge = new Gauge({
      name: "pgbouncer_query_rate",
      help: "Queries per second through PgBouncer",
      labelNames: ["environment", "instance", "database"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "pgbouncer_query_rate",
      labelNames: ["environment", "instance", "database"],
    });

    this.pgbouncerAvgQueryTimeGauge = new Gauge({
      name: "pgbouncer_avg_query_time_us",
      help: "Average query time in microseconds",
      labelNames: ["environment", "instance", "database"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "pgbouncer_avg_query_time_us",
      labelNames: ["environment", "instance", "database"],
    });

    this.pgbouncerAvgWaitTimeGauge = new Gauge({
      name: "pgbouncer_avg_wait_time_us",
      help: "Average client wait time in microseconds",
      labelNames: ["environment", "instance", "database"],
      registers: [this.registry],
    });
    this.metricDescriptors.push({
      name: "pgbouncer_avg_wait_time_us",
      labelNames: ["environment", "instance", "database"],
    });
  }

  static getInstance(): TelemetryMetricsRegistry {
    if (!this.instance) {
      this.instance = new TelemetryMetricsRegistry();
    }
    return this.instance;
  }

  static refreshEnvironment(): void {
    const current = this.getInstance();
    current.environmentLabel = current.resolveEnvironmentLabel();
    current.instanceLabel = current.resolveInstanceLabel();
  }

  static describe(): MetricDescriptor[] {
    return this.getInstance().metricDescriptors.map((descriptor) => ({
      ...descriptor,
    }));
  }

  getRegistry(): Registry {
    return this.registry;
  }

  setWebsocketConnections(activeConnections: number): void {
    const safeValue = Number.isFinite(activeConnections)
      ? Math.max(0, activeConnections)
      : 0;
    this.wsConnectionsGauge
      .labels(this.environmentLabel, this.instanceLabel)
      .set(safeValue);
  }

  incrementThroughput(type: MessageThroughputType): void {
    this.messageThroughputCounter
      .labels(this.environmentLabel, this.instanceLabel, type)
      .inc();
  }

  observeDeliveryLatency(
    event: DeliveryLatencyEvent,
    durationMs: number,
  ): void {
    const safeDuration = Number.isFinite(durationMs)
      ? Math.max(0, durationMs)
      : 0;
    this.deliveryLatencyHistogram
      .labels(this.environmentLabel, this.instanceLabel, event)
      .observe(safeDuration);
  }

  incrementError(event: TelemetryErrorEvent): void {
    this.errorCounter
      .labels(this.environmentLabel, this.instanceLabel, event)
      .inc();
  }

  recordHandshake(result: HandshakeResult): void {
    const eventLabel =
      result === "accepted" ? "handshake.accepted" : "handshake.rejected";
    this.handshakeCounter
      .labels(this.environmentLabel, this.instanceLabel, eventLabel)
      .inc();
  }

  recordAdapterConnect(event: string): void {
    this.adapterConnectCounter
      .labels(this.environmentLabel, this.instanceLabel, event)
      .inc();
  }

  recordAdapterError(event: string): void {
    this.adapterErrorCounter
      .labels(this.environmentLabel, this.instanceLabel, event)
      .inc();
  }

  recordAdapterHeartbeat(timestampMs: number): void {
    const safeTimestamp = Number.isFinite(timestampMs)
      ? Math.max(0, timestampMs)
      : Date.now();
    this.adapterHeartbeatGauge
      .labels(this.environmentLabel, this.instanceLabel)
      .set(safeTimestamp);
  }

  recordSocketDisconnect(reason: string): void {
    this.socketDisconnectCounter
      .labels(this.environmentLabel, this.instanceLabel, reason)
      .inc();
  }

  incrementPresenceWrite(event: "connect" | "disconnect" | "cleanup"): void {
    this.presenceWriteCounter
      .labels(this.environmentLabel, this.instanceLabel, event)
      .inc();
  }

  incrementHeartbeatExtend(result: "success" | "error"): void {
    this.heartbeatExtendCounter
      .labels(this.environmentLabel, this.instanceLabel, result)
      .inc();
  }

  incrementReplayCount(source: ReplaySource, count = 1): void {
    const safeCount = Number.isFinite(count) ? Math.max(0, count) : 0;
    if (safeCount === 0) {
      return;
    }
    this.replayCounter
      .labels(this.environmentLabel, this.instanceLabel, source)
      .inc(safeCount);
  }

  incrementDedupeHit(context: DedupeContext, count = 1): void {
    const safeCount = Number.isFinite(count) ? Math.max(0, count) : 0;
    if (safeCount === 0) {
      return;
    }
    this.dedupeCounter
      .labels(this.environmentLabel, this.instanceLabel, context)
      .inc(safeCount);
  }

  // Database pooling metrics methods
  setDbConnections(pool: string, status: DbPoolStatus, count: number): void {
    const safeCount = Number.isFinite(count) ? Math.max(0, count) : 0;
    this.dbConnectionsGauge
      .labels(this.environmentLabel, this.instanceLabel, pool, status)
      .set(safeCount);
  }

  observeDbQueueWait(pool: string, waitTimeMs: number): void {
    const safeWait = Number.isFinite(waitTimeMs) ? Math.max(0, waitTimeMs) : 0;
    this.dbQueueWaitHistogram
      .labels(this.environmentLabel, this.instanceLabel, pool)
      .observe(safeWait);
  }

  observeDbTransactionDuration(
    pool: string,
    operation: string,
    durationMs: number,
  ): void {
    const safeDuration = Number.isFinite(durationMs)
      ? Math.max(0, durationMs)
      : 0;
    this.dbTransactionDurationHistogram
      .labels(this.environmentLabel, this.instanceLabel, pool, operation)
      .observe(safeDuration);
  }

  incrementDbQuery(type: DbQueryType, status: "success" | "error"): void {
    this.dbQueryCounter
      .labels(this.environmentLabel, this.instanceLabel, type, status)
      .inc();
  }

  setDbPoolSaturation(pool: string, ratio: number): void {
    const safeRatio = Number.isFinite(ratio)
      ? Math.max(0, Math.min(1, ratio))
      : 0;
    this.dbPoolSaturationGauge
      .labels(this.environmentLabel, this.instanceLabel, pool)
      .set(safeRatio);
  }

  // Cache metrics methods
  incrementCacheOperation(
    operation: CacheOperation,
    result: CacheResult,
    entity: string,
  ): void {
    this.cacheOperationCounter
      .labels(
        this.environmentLabel,
        this.instanceLabel,
        operation,
        result,
        entity,
      )
      .inc();
  }

  setCacheHitRatio(entity: string, ratio: number): void {
    const safeRatio = Number.isFinite(ratio)
      ? Math.max(0, Math.min(1, ratio))
      : 0;
    this.cacheHitRatioGauge
      .labels(this.environmentLabel, this.instanceLabel, entity)
      .set(safeRatio);
  }

  observeCacheLatency(
    operation: CacheOperation,
    entity: string,
    latencyMs: number,
  ): void {
    const safeLatency = Number.isFinite(latencyMs) ? Math.max(0, latencyMs) : 0;
    this.cacheLatencyHistogram
      .labels(this.environmentLabel, this.instanceLabel, operation, entity)
      .observe(safeLatency);
  }

  incrementCacheEviction(
    entity: string,
    reason: "ttl" | "invalidation" | "memory",
  ): void {
    this.cacheEvictionCounter
      .labels(this.environmentLabel, this.instanceLabel, entity, reason)
      .inc();
  }

  setCacheSize(entity: string, sizeBytes: number): void {
    const safeSize = Number.isFinite(sizeBytes) ? Math.max(0, sizeBytes) : 0;
    this.cacheSizeGauge
      .labels(this.environmentLabel, this.instanceLabel, entity)
      .set(safeSize);
  }

  // Read replica metrics methods
  setReplicaLag(lagSeconds: number): void {
    const safeLag = Number.isFinite(lagSeconds) ? Math.max(0, lagSeconds) : 0;
    this.replicaLagGauge
      .labels(this.environmentLabel, this.instanceLabel)
      .set(safeLag);
  }

  setReplicaHealth(healthy: 0 | 1): void {
    this.replicaHealthGauge
      .labels(this.environmentLabel, this.instanceLabel)
      .set(healthy);
  }

  setReplicaLagBytes(lagBytes: number): void {
    const safeLag = Number.isFinite(lagBytes) ? Math.max(0, lagBytes) : 0;
    this.replicaLagBytesGauge
      .labels(this.environmentLabel, this.instanceLabel)
      .set(safeLag);
  }

  incrementReadRouting(
    target: "primary" | "replica" | "fallback",
    endpoint: string,
  ): void {
    this.readRoutingCounter
      .labels(this.environmentLabel, this.instanceLabel, target, endpoint)
      .inc();
  }

  // Vacuum health metrics methods
  setTableDeadTuples(deadTuples: number, table: string, schema: string): void {
    const safeTuples = Number.isFinite(deadTuples)
      ? Math.max(0, deadTuples)
      : 0;
    this.tableDeadTuplesGauge
      .labels(this.environmentLabel, this.instanceLabel, table, schema)
      .set(safeTuples);
  }

  setTableBloatRatio(ratio: number, table: string, schema: string): void {
    const safeRatio = Number.isFinite(ratio)
      ? Math.max(0, Math.min(1, ratio))
      : 0;
    this.tableBloatRatioGauge
      .labels(this.environmentLabel, this.instanceLabel, table, schema)
      .set(safeRatio);
  }

  setVacuumLagSeconds(lagSeconds: number, table: string, schema: string): void {
    const safeLag = Number.isFinite(lagSeconds) ? Math.max(0, lagSeconds) : 0;
    this.vacuumLagSecondsGauge
      .labels(this.environmentLabel, this.instanceLabel, table, schema)
      .set(safeLag);
  }

  setAnalyzeLagSeconds(
    lagSeconds: number,
    table: string,
    schema: string,
  ): void {
    const safeLag = Number.isFinite(lagSeconds) ? Math.max(0, lagSeconds) : 0;
    this.analyzeLagSecondsGauge
      .labels(this.environmentLabel, this.instanceLabel, table, schema)
      .set(safeLag);
  }

  setAutovacuumRunning(running: 0 | 1, table: string, schema: string): void {
    this.autovacuumRunningGauge
      .labels(this.environmentLabel, this.instanceLabel, table, schema)
      .set(running);
  }

  // Query performance metrics methods
  observeQueryDuration(
    endpoint: string,
    queryType: string,
    model: string,
    durationMs: number,
  ): void {
    const safeDuration = Number.isFinite(durationMs)
      ? Math.max(0, durationMs)
      : 0;
    this.queryDurationHistogram
      .labels(
        this.environmentLabel,
        this.instanceLabel,
        endpoint,
        queryType,
        model,
      )
      .observe(safeDuration);
  }

  incrementSlowQuery(endpoint: string, model: string, threshold: string): void {
    this.slowQueryCounter
      .labels(
        this.environmentLabel,
        this.instanceLabel,
        endpoint,
        model,
        threshold,
      )
      .inc();
  }

  incrementQueryError(
    endpoint: string,
    model: string,
    errorType: string,
  ): void {
    this.queryErrorCounter
      .labels(
        this.environmentLabel,
        this.instanceLabel,
        endpoint,
        model,
        errorType,
      )
      .inc();
  }

  // PgBouncer metrics methods
  setPgBouncerActiveConnections(
    count: number,
    database: string,
    poolMode: string,
  ): void {
    const safeCount = Number.isFinite(count) ? Math.max(0, count) : 0;
    this.pgbouncerActiveConnectionsGauge
      .labels(this.environmentLabel, this.instanceLabel, database, poolMode)
      .set(safeCount);
  }

  setPgBouncerIdleConnections(
    count: number,
    database: string,
    poolMode: string,
  ): void {
    const safeCount = Number.isFinite(count) ? Math.max(0, count) : 0;
    this.pgbouncerIdleConnectionsGauge
      .labels(this.environmentLabel, this.instanceLabel, database, poolMode)
      .set(safeCount);
  }

  setPgBouncerWaitingClients(count: number, database: string): void {
    const safeCount = Number.isFinite(count) ? Math.max(0, count) : 0;
    this.pgbouncerWaitingClientsGauge
      .labels(this.environmentLabel, this.instanceLabel, database)
      .set(safeCount);
  }

  setPgBouncerPoolSaturation(ratio: number, database: string): void {
    const safeRatio = Number.isFinite(ratio)
      ? Math.max(0, Math.min(1, ratio))
      : 0;
    this.pgbouncerPoolSaturationGauge
      .labels(this.environmentLabel, this.instanceLabel, database)
      .set(safeRatio);
  }

  setPgBouncerTransactionRate(rate: number, database: string): void {
    const safeRate = Number.isFinite(rate) ? Math.max(0, rate) : 0;
    this.pgbouncerTransactionRateGauge
      .labels(this.environmentLabel, this.instanceLabel, database)
      .set(safeRate);
  }

  setPgBouncerQueryRate(rate: number, database: string): void {
    const safeRate = Number.isFinite(rate) ? Math.max(0, rate) : 0;
    this.pgbouncerQueryRateGauge
      .labels(this.environmentLabel, this.instanceLabel, database)
      .set(safeRate);
  }

  setPgBouncerAvgQueryTime(timeUs: number, database: string): void {
    const safeTime = Number.isFinite(timeUs) ? Math.max(0, timeUs) : 0;
    this.pgbouncerAvgQueryTimeGauge
      .labels(this.environmentLabel, this.instanceLabel, database)
      .set(safeTime);
  }

  setPgBouncerAvgWaitTime(timeUs: number, database: string): void {
    const safeTime = Number.isFinite(timeUs) ? Math.max(0, timeUs) : 0;
    this.pgbouncerAvgWaitTimeGauge
      .labels(this.environmentLabel, this.instanceLabel, database)
      .set(safeTime);
  }

  private resolveEnvironmentLabel(): string {
    try {
      return getEnv().service.nodeEnv;
    } catch (error) {
      return process.env.NODE_ENV ?? "development";
    }
  }

  private resolveInstanceLabel(): string {
    try {
      return getEnv().realtime.instanceId ?? "unknown";
    } catch (error) {
      return (
        process.env.SOCKET_INSTANCE_ID ??
        process.env.INSTANCE_ID ??
        process.env.HOSTNAME ??
        `pid-${process.pid}`
      );
    }
  }
}

export class TelemetryMetrics {
  static registry(): Registry {
    return TelemetryMetricsRegistry.getInstance().getRegistry();
  }

  static refreshEnvironment(): void {
    TelemetryMetricsRegistry.refreshEnvironment();
  }

  static describe(): MetricDescriptor[] {
    return TelemetryMetricsRegistry.describe();
  }

  static setWsConnections(count: number): void {
    TelemetryMetricsRegistry.getInstance().setWebsocketConnections(count);
  }

  static incrementThroughput(type: MessageThroughputType): void {
    TelemetryMetricsRegistry.getInstance().incrementThroughput(type);
  }

  static observeDeliveryLatency(
    event: DeliveryLatencyEvent,
    durationMs: number,
  ): void {
    TelemetryMetricsRegistry.getInstance().observeDeliveryLatency(
      event,
      durationMs,
    );
  }

  static incrementError(event: TelemetryErrorEvent): void {
    TelemetryMetricsRegistry.getInstance().incrementError(event);
  }

  static recordHandshake(result: HandshakeResult): void {
    TelemetryMetricsRegistry.getInstance().recordHandshake(result);
  }

  static recordAdapterConnect(event: string): void {
    TelemetryMetricsRegistry.getInstance().recordAdapterConnect(event);
  }

  static recordAdapterError(event: string): void {
    TelemetryMetricsRegistry.getInstance().recordAdapterError(event);
  }

  static recordAdapterHeartbeat(timestampMs: number): void {
    TelemetryMetricsRegistry.getInstance().recordAdapterHeartbeat(timestampMs);
  }

  static recordDisconnect(reason: string): void {
    TelemetryMetricsRegistry.getInstance().recordSocketDisconnect(reason);
  }

  static incrementPresenceWrite(
    event: "connect" | "disconnect" | "cleanup",
  ): void {
    TelemetryMetricsRegistry.getInstance().incrementPresenceWrite(event);
  }

  static incrementHeartbeatExtend(result: "success" | "error"): void {
    TelemetryMetricsRegistry.getInstance().incrementHeartbeatExtend(result);
  }

  static incrementReplayCount(source: ReplaySource, count: number): void {
    TelemetryMetricsRegistry.getInstance().incrementReplayCount(source, count);
  }

  static incrementDedupeHit(context: DedupeContext, count: number): void {
    TelemetryMetricsRegistry.getInstance().incrementDedupeHit(context, count);
  }

  // Database pooling metrics
  static setDbConnections(
    pool: string,
    status: DbPoolStatus,
    count: number,
  ): void {
    TelemetryMetricsRegistry.getInstance().setDbConnections(
      pool,
      status,
      count,
    );
  }

  static observeDbQueueWait(pool: string, waitTimeMs: number): void {
    TelemetryMetricsRegistry.getInstance().observeDbQueueWait(pool, waitTimeMs);
  }

  static observeDbTransactionDuration(
    pool: string,
    operation: string,
    durationMs: number,
  ): void {
    TelemetryMetricsRegistry.getInstance().observeDbTransactionDuration(
      pool,
      operation,
      durationMs,
    );
  }

  static incrementDbQuery(
    type: DbQueryType,
    status: "success" | "error",
  ): void {
    TelemetryMetricsRegistry.getInstance().incrementDbQuery(type, status);
  }

  static setDbPoolSaturation(pool: string, ratio: number): void {
    TelemetryMetricsRegistry.getInstance().setDbPoolSaturation(pool, ratio);
  }

  // Cache metrics
  static incrementCacheOperation(
    operation: CacheOperation,
    result: CacheResult,
    entity: string,
  ): void {
    TelemetryMetricsRegistry.getInstance().incrementCacheOperation(
      operation,
      result,
      entity,
    );
  }

  static setCacheHitRatio(entity: string, ratio: number): void {
    TelemetryMetricsRegistry.getInstance().setCacheHitRatio(entity, ratio);
  }

  static observeCacheLatency(
    operation: CacheOperation,
    entity: string,
    latencyMs: number,
  ): void {
    TelemetryMetricsRegistry.getInstance().observeCacheLatency(
      operation,
      entity,
      latencyMs,
    );
  }

  static incrementCacheEviction(
    entity: string,
    reason: "ttl" | "invalidation" | "memory",
  ): void {
    TelemetryMetricsRegistry.getInstance().incrementCacheEviction(
      entity,
      reason,
    );
  }

  static setCacheSize(entity: string, sizeBytes: number): void {
    TelemetryMetricsRegistry.getInstance().setCacheSize(entity, sizeBytes);
  }

  // Read replica metrics
  static setReplicaLag(lagSeconds: number): void {
    TelemetryMetricsRegistry.getInstance().setReplicaLag(lagSeconds);
  }

  static setReplicaHealth(healthy: 0 | 1): void {
    TelemetryMetricsRegistry.getInstance().setReplicaHealth(healthy);
  }

  static setReplicaLagBytes(lagBytes: number): void {
    TelemetryMetricsRegistry.getInstance().setReplicaLagBytes(lagBytes);
  }

  static incrementReadRouting(
    target: "primary" | "replica" | "fallback",
    endpoint: string,
  ): void {
    TelemetryMetricsRegistry.getInstance().incrementReadRouting(
      target,
      endpoint,
    );
  }

  // Vacuum health metrics
  static setTableDeadTuples(
    deadTuples: number,
    table: string,
    schema: string,
  ): void {
    TelemetryMetricsRegistry.getInstance().setTableDeadTuples(
      deadTuples,
      table,
      schema,
    );
  }

  static setTableBloatRatio(
    ratio: number,
    table: string,
    schema: string,
  ): void {
    TelemetryMetricsRegistry.getInstance().setTableBloatRatio(
      ratio,
      table,
      schema,
    );
  }

  static setVacuumLagSeconds(
    lagSeconds: number,
    table: string,
    schema: string,
  ): void {
    TelemetryMetricsRegistry.getInstance().setVacuumLagSeconds(
      lagSeconds,
      table,
      schema,
    );
  }

  static setAnalyzeLagSeconds(
    lagSeconds: number,
    table: string,
    schema: string,
  ): void {
    TelemetryMetricsRegistry.getInstance().setAnalyzeLagSeconds(
      lagSeconds,
      table,
      schema,
    );
  }

  static setAutovacuumRunning(
    running: 0 | 1,
    table: string,
    schema: string,
  ): void {
    TelemetryMetricsRegistry.getInstance().setAutovacuumRunning(
      running,
      table,
      schema,
    );
  }

  // Query performance metrics
  static observeQueryDuration(
    endpoint: string,
    queryType: string,
    model: string,
    durationMs: number,
  ): void {
    TelemetryMetricsRegistry.getInstance().observeQueryDuration(
      endpoint,
      queryType,
      model,
      durationMs,
    );
  }

  static incrementSlowQuery(
    endpoint: string,
    model: string,
    threshold: string,
  ): void {
    TelemetryMetricsRegistry.getInstance().incrementSlowQuery(
      endpoint,
      model,
      threshold,
    );
  }

  static incrementQueryError(
    endpoint: string,
    model: string,
    errorType: string,
  ): void {
    TelemetryMetricsRegistry.getInstance().incrementQueryError(
      endpoint,
      model,
      errorType,
    );
  }

  // PgBouncer metrics
  static setPgBouncerActiveConnections(
    count: number,
    database: string,
    poolMode: string,
  ): void {
    TelemetryMetricsRegistry.getInstance().setPgBouncerActiveConnections(
      count,
      database,
      poolMode,
    );
  }

  static setPgBouncerIdleConnections(
    count: number,
    database: string,
    poolMode: string,
  ): void {
    TelemetryMetricsRegistry.getInstance().setPgBouncerIdleConnections(
      count,
      database,
      poolMode,
    );
  }

  static setPgBouncerWaitingClients(count: number, database: string): void {
    TelemetryMetricsRegistry.getInstance().setPgBouncerWaitingClients(
      count,
      database,
    );
  }

  static setPgBouncerPoolSaturation(ratio: number, database: string): void {
    TelemetryMetricsRegistry.getInstance().setPgBouncerPoolSaturation(
      ratio,
      database,
    );
  }

  static setPgBouncerTransactionRate(rate: number, database: string): void {
    TelemetryMetricsRegistry.getInstance().setPgBouncerTransactionRate(
      rate,
      database,
    );
  }

  static setPgBouncerQueryRate(rate: number, database: string): void {
    TelemetryMetricsRegistry.getInstance().setPgBouncerQueryRate(
      rate,
      database,
    );
  }

  static setPgBouncerAvgQueryTime(timeUs: number, database: string): void {
    TelemetryMetricsRegistry.getInstance().setPgBouncerAvgQueryTime(
      timeUs,
      database,
    );
  }

  static setPgBouncerAvgWaitTime(timeUs: number, database: string): void {
    TelemetryMetricsRegistry.getInstance().setPgBouncerAvgWaitTime(
      timeUs,
      database,
    );
  }
}
