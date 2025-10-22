import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TelemetryMetrics } from "../../observability/metrics-registry";

/**
 * PgBouncerMonitor
 *
 * Monitors PgBouncer connection pooling health and performance.
 *
 * Connects directly to PgBouncer's admin interface (pgbouncer database)
 * to collect real-time pool statistics.
 *
 * WHAT IT TRACKS:
 * 1. Pool Saturation: Active vs total connections
 * 2. Queue Wait Time: Client wait time for available server connection
 * 3. Server Connections: Active, idle, used connections by pool
 * 4. Transaction Rates: Transactions and queries per second
 * 5. Pool Efficiency: Connection reuse metrics
 *
 * PGBOUNCER ADMIN COMMANDS:
 * - SHOW STATS: Transaction and query rates per database
 * - SHOW POOLS: Connection counts (active, idle, waiting) per pool
 * - SHOW LISTS: Client and server connection lists
 * - SHOW DATABASES: Database configuration
 *
 * CONNECTION SETUP:
 * Requires separate connection to PgBouncer admin interface:
 *   postgres://pgbouncer:password@localhost:6432/pgbouncer
 *
 * METRICS EMITTED:
 * - pgbouncer_active_connections{database, pool_mode} - Gauge
 * - pgbouncer_idle_connections{database, pool_mode} - Gauge
 * - pgbouncer_waiting_clients{database} - Gauge
 * - pgbouncer_pool_saturation{database} - Gauge (0-1)
 * - pgbouncer_transaction_rate{database} - Gauge (TPS)
 * - pgbouncer_query_rate{database} - Gauge (QPS)
 * - pgbouncer_avg_query_time{database} - Gauge (microseconds)
 *
 * ALERTS TRIGGERED:
 * - Pool saturation > 80% for 5 minutes
 * - Waiting clients > 10 for 2 minutes
 * - Average query time > 100ms consistently
 *
 * @see AutovacuumConfigService for database tuning
 * @see VacuumHealthMonitor for table health
 */

export interface PgBouncerPoolStats {
  database: string;
  user: string;
  clActive: number; // Active client connections
  clWaiting: number; // Waiting client connections
  svActive: number; // Active server connections
  svIdle: number; // Idle server connections
  svUsed: number; // Used server connections
  svTested: number; // Recently tested server connections
  svLogin: number; // Server connections in login state
  maxWait: number; // Longest wait time in seconds
  poolMode: string; // transaction | session | statement
}

export interface PgBouncerDatabaseStats {
  database: string;
  totalXactCount: number; // Total transactions
  totalQueryCount: number; // Total queries
  totalReceived: number; // Bytes received
  totalSent: number; // Bytes sent
  totalXactTime: number; // Total transaction time (microseconds)
  totalQueryTime: number; // Total query time (microseconds)
  totalWaitTime: number; // Total wait time (microseconds)
  avgXactCount: number; // Transactions per second
  avgQueryCount: number; // Queries per second
  avgRecv: number; // Bytes received per second
  avgSent: number; // Bytes sent per second
  avgXactTime: number; // Average transaction time (microseconds)
  avgQueryTime: number; // Average query time (microseconds)
  avgWaitTime: number; // Average wait time (microseconds)
}

export interface PgBouncerHealthSummary {
  connected: boolean;
  totalActivePools: number;
  totalActiveConnections: number;
  totalIdleConnections: number;
  totalWaitingClients: number;
  highestPoolSaturation: number;
  longestWaitTime: number;
  averageQueryTime: number;
  transactionRate: number;
}

@Injectable()
export class PgBouncerMonitor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PgBouncerMonitor.name);
  private pollInterval: NodeJS.Timeout | null = null;
  private connected = false;

  /** Polling interval in milliseconds (default: 30 seconds) */
  private readonly POLL_INTERVAL_MS = parseInt(
    process.env.PGBOUNCER_POLL_INTERVAL || "30000",
    10,
  );

  /** Alert thresholds */
  private readonly THRESHOLDS = {
    poolSaturation: 0.8, // 80%
    waitingClients: 10, // 10 clients
    avgQueryTimeUs: 100000, // 100ms in microseconds
  };

  /** Cached stats */
  private lastPoolStats = new Map<string, PgBouncerPoolStats>();
  private lastDatabaseStats = new Map<string, PgBouncerDatabaseStats>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    this.logger.log("PgBouncerMonitor initialized");
    this.logger.log(`Polling every ${this.POLL_INTERVAL_MS / 1000}s`);
    this.logger.log(
      "Note: PgBouncer admin queries via SHOW commands require direct PgBouncer connection",
    );

    // Check if we can query PgBouncer stats via current connection
    try {
      await this.testConnection();
      this.connected = true;

      // Initial poll
      await this.pollPgBouncerStats();

      // Start periodic polling
      this.pollInterval = setInterval(
        () => this.pollPgBouncerStats(),
        this.POLL_INTERVAL_MS,
      );
    } catch (error) {
      this.logger.warn(
        "PgBouncer monitoring disabled - cannot query SHOW POOLS",
        error,
      );
    }
  }

  async onModuleDestroy() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Test if we can query PgBouncer admin commands
   */
  private async testConnection(): Promise<void> {
    try {
      // Test SHOW POOLS command
      await this.prisma.$queryRaw`SHOW POOLS`;
      this.logger.log("PgBouncer admin commands accessible");
    } catch (error) {
      throw new Error(
        "Cannot access PgBouncer admin commands. Ensure connection string uses pgbouncer=true",
      );
    }
  }

  /**
   * Poll PgBouncer statistics
   */
  private async pollPgBouncerStats(): Promise<void> {
    if (!this.connected) {
      return;
    }

    try {
      // Fetch pool stats
      const poolStats = await this.fetchPoolStats();
      for (const stat of poolStats) {
        const key = `${stat.database}.${stat.user}`;
        this.lastPoolStats.set(key, stat);
        this.emitPoolMetrics(stat);
        this.checkPoolThresholds(stat);
      }

      // Fetch database stats
      const dbStats = await this.fetchDatabaseStats();
      for (const stat of dbStats) {
        this.lastDatabaseStats.set(stat.database, stat);
        this.emitDatabaseMetrics(stat);
        this.checkDatabaseThresholds(stat);
      }

      // Log summary
      const summary = this.getSummary();
      this.logger.debug(
        `PgBouncer health: ${summary.totalActiveConnections} active, ` +
          `${summary.totalIdleConnections} idle, ` +
          `${summary.totalWaitingClients} waiting, ` +
          `saturation ${(summary.highestPoolSaturation * 100).toFixed(1)}%`,
      );
    } catch (error) {
      this.logger.error("Failed to poll PgBouncer stats", error);
      this.connected = false;
    }
  }

  /**
   * Fetch SHOW POOLS statistics
   */
  private async fetchPoolStats(): Promise<PgBouncerPoolStats[]> {
    const result: any[] = await this.prisma.$queryRaw`SHOW POOLS`;

    return result.map((row) => ({
      database: row.database,
      user: row.user,
      clActive: parseInt(row.cl_active, 10) || 0,
      clWaiting: parseInt(row.cl_waiting, 10) || 0,
      svActive: parseInt(row.sv_active, 10) || 0,
      svIdle: parseInt(row.sv_idle, 10) || 0,
      svUsed: parseInt(row.sv_used, 10) || 0,
      svTested: parseInt(row.sv_tested, 10) || 0,
      svLogin: parseInt(row.sv_login, 10) || 0,
      maxWait: parseInt(row.maxwait, 10) || 0,
      poolMode: row.pool_mode || "transaction",
    }));
  }

  /**
   * Fetch SHOW STATS statistics
   */
  private async fetchDatabaseStats(): Promise<PgBouncerDatabaseStats[]> {
    const result: any[] = await this.prisma.$queryRaw`SHOW STATS`;

    return result
      .filter((row) => row.database !== "pgbouncer") // Exclude admin db
      .map((row) => ({
        database: row.database,
        totalXactCount: parseInt(row.total_xact_count, 10) || 0,
        totalQueryCount: parseInt(row.total_query_count, 10) || 0,
        totalReceived: parseInt(row.total_received, 10) || 0,
        totalSent: parseInt(row.total_sent, 10) || 0,
        totalXactTime: parseInt(row.total_xact_time, 10) || 0,
        totalQueryTime: parseInt(row.total_query_time, 10) || 0,
        totalWaitTime: parseInt(row.total_wait_time, 10) || 0,
        avgXactCount: parseInt(row.avg_xact_count, 10) || 0,
        avgQueryCount: parseInt(row.avg_query_count, 10) || 0,
        avgRecv: parseInt(row.avg_recv, 10) || 0,
        avgSent: parseInt(row.avg_sent, 10) || 0,
        avgXactTime: parseInt(row.avg_xact_time, 10) || 0,
        avgQueryTime: parseInt(row.avg_query_time, 10) || 0,
        avgWaitTime: parseInt(row.avg_wait_time, 10) || 0,
      }));
  }

  /**
   * Emit pool metrics to Prometheus
   */
  private emitPoolMetrics(stat: PgBouncerPoolStats): void {
    const labels = {
      database: stat.database,
      pool_mode: stat.poolMode,
    };

    // Active connections
    TelemetryMetrics.setPgBouncerActiveConnections(
      stat.svActive,
      labels.database,
      labels.pool_mode,
    );

    // Idle connections
    TelemetryMetrics.setPgBouncerIdleConnections(
      stat.svIdle,
      labels.database,
      labels.pool_mode,
    );

    // Waiting clients
    TelemetryMetrics.setPgBouncerWaitingClients(
      stat.clWaiting,
      labels.database,
    );

    // Pool saturation (active / (active + idle))
    const totalCapacity = stat.svActive + stat.svIdle;
    const saturation = totalCapacity > 0 ? stat.svActive / totalCapacity : 0;
    TelemetryMetrics.setPgBouncerPoolSaturation(saturation, labels.database);
  }

  /**
   * Emit database metrics to Prometheus
   */
  private emitDatabaseMetrics(stat: PgBouncerDatabaseStats): void {
    // Transaction rate (TPS)
    TelemetryMetrics.setPgBouncerTransactionRate(
      stat.avgXactCount,
      stat.database,
    );

    // Query rate (QPS)
    TelemetryMetrics.setPgBouncerQueryRate(stat.avgQueryCount, stat.database);

    // Average query time
    TelemetryMetrics.setPgBouncerAvgQueryTime(stat.avgQueryTime, stat.database);

    // Average wait time
    TelemetryMetrics.setPgBouncerAvgWaitTime(stat.avgWaitTime, stat.database);
  }

  /**
   * Check pool thresholds and log warnings
   */
  private checkPoolThresholds(stat: PgBouncerPoolStats): void {
    // Pool saturation
    const totalCapacity = stat.svActive + stat.svIdle;
    if (totalCapacity > 0) {
      const saturation = stat.svActive / totalCapacity;
      if (saturation > this.THRESHOLDS.poolSaturation) {
        this.logger.warn(
          `HIGH POOL SATURATION: ${stat.database} at ${(saturation * 100).toFixed(1)}% ` +
            `(${stat.svActive} active / ${totalCapacity} total)`,
        );
      }
    }

    // Waiting clients
    if (stat.clWaiting > this.THRESHOLDS.waitingClients) {
      this.logger.warn(
        `HIGH WAITING CLIENTS: ${stat.database} has ${stat.clWaiting} clients waiting ` +
          `(threshold: ${this.THRESHOLDS.waitingClients})`,
      );
    }

    // Max wait time
    if (stat.maxWait > 5) {
      this.logger.warn(
        `LONG WAIT TIME: ${stat.database} max wait ${stat.maxWait}s`,
      );
    }
  }

  /**
   * Check database thresholds and log warnings
   */
  private checkDatabaseThresholds(stat: PgBouncerDatabaseStats): void {
    // Average query time
    if (stat.avgQueryTime > this.THRESHOLDS.avgQueryTimeUs) {
      this.logger.warn(
        `SLOW QUERIES: ${stat.database} average query time ${(stat.avgQueryTime / 1000).toFixed(2)}ms ` +
          `(threshold: ${this.THRESHOLDS.avgQueryTimeUs / 1000}ms)`,
      );
    }
  }

  /**
   * Get summary of PgBouncer health
   */
  getSummary(): PgBouncerHealthSummary {
    const poolStats = Array.from(this.lastPoolStats.values());
    const dbStats = Array.from(this.lastDatabaseStats.values());

    const totalActiveConnections = poolStats.reduce(
      (sum, p) => sum + p.svActive,
      0,
    );
    const totalIdleConnections = poolStats.reduce(
      (sum, p) => sum + p.svIdle,
      0,
    );
    const totalWaitingClients = poolStats.reduce(
      (sum, p) => sum + p.clWaiting,
      0,
    );

    const saturations = poolStats
      .map((p) => {
        const total = p.svActive + p.svIdle;
        return total > 0 ? p.svActive / total : 0;
      })
      .filter((s) => s > 0);

    const highestPoolSaturation =
      saturations.length > 0 ? Math.max(...saturations) : 0;

    const longestWaitTime = Math.max(...poolStats.map((p) => p.maxWait), 0);

    const averageQueryTime =
      dbStats.length > 0
        ? dbStats.reduce((sum, d) => sum + d.avgQueryTime, 0) / dbStats.length
        : 0;

    const transactionRate = dbStats.reduce((sum, d) => sum + d.avgXactCount, 0);

    return {
      connected: this.connected,
      totalActivePools: poolStats.length,
      totalActiveConnections,
      totalIdleConnections,
      totalWaitingClients,
      highestPoolSaturation,
      longestWaitTime,
      averageQueryTime,
      transactionRate,
    };
  }

  /**
   * Get pool stats for a specific database
   */
  getPoolStats(database: string): PgBouncerPoolStats | undefined {
    for (const [key, stat] of this.lastPoolStats.entries()) {
      if (stat.database === database) {
        return stat;
      }
    }
    return undefined;
  }

  /**
   * Get database stats
   */
  getDatabaseStats(database: string): PgBouncerDatabaseStats | undefined {
    return this.lastDatabaseStats.get(database);
  }

  /**
   * Force immediate poll (for testing/debugging)
   */
  async forcePoll(): Promise<void> {
    await this.pollPgBouncerStats();
  }
}
