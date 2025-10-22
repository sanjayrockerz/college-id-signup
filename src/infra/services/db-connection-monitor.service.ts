import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { getPrismaClient } from "../../config/database";
import { TelemetryMetrics } from "../../observability/metrics-registry";

/**
 * Database Connection Pool Monitor
 *
 * Tracks PgBouncer connection pool metrics and emits them to Prometheus:
 * - server_connections: Active connections to PostgreSQL
 * - db_tx_queue_wait_ms: Time spent waiting for connections
 * - db_transaction_duration_ms: Transaction execution time
 * - db_pool_saturation_ratio: Pool utilization (0-1)
 *
 * Polls PgBouncer SHOW STATS and SHOW POOLS every 15 seconds
 */
@Injectable()
export class DbConnectionMonitor implements OnModuleInit {
  private readonly logger = new Logger(DbConnectionMonitor.name);
  private readonly enabled: boolean;
  private readonly pollInterval = 15000; // 15 seconds
  private pollTimer: NodeJS.Timeout | null = null;

  // Connection limits (from PgBouncer config)
  private readonly poolLimits = {
    pgbouncer: {
      default_pool_size: parseInt(
        process.env.PGBOUNCER_DEFAULT_POOL_SIZE || "20",
      ),
      max_client_conn: parseInt(
        process.env.PGBOUNCER_MAX_CLIENT_CONN || "10000",
      ),
    },
  };

  constructor() {
    this.enabled = process.env.ENABLE_DB_METRICS !== "false";
  }

  async onModuleInit() {
    if (!this.enabled) {
      this.logger.warn("Database connection monitoring is disabled");
      return;
    }

    this.logger.log("Starting database connection pool monitor");

    // Initial poll
    await this.pollMetrics();

    // Start periodic polling
    this.pollTimer = setInterval(() => {
      this.pollMetrics().catch((err) => {
        this.logger.error(`Failed to poll DB metrics: ${err.message}`);
      });
    }, this.pollInterval);
  }

  onModuleDestroy() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Poll PgBouncer statistics and emit metrics
   */
  private async pollMetrics(): Promise<void> {
    try {
      const prisma = getPrismaClient();

      // Query PgBouncer SHOW POOLS
      // This requires Prisma to be connected through PgBouncer with ?pgbouncer=true
      const pools = await prisma.$queryRaw<any[]>`SHOW POOLS`;

      if (pools && pools.length > 0) {
        for (const pool of pools) {
          const poolName = `${pool.database}:${pool.user}`;

          // Emit connection counts by status
          TelemetryMetrics.setDbConnections(
            "pgbouncer",
            "available",
            pool.cl_idle || 0,
          );
          TelemetryMetrics.setDbConnections(
            "pgbouncer",
            "used",
            pool.cl_active || 0,
          );
          TelemetryMetrics.setDbConnections(
            "pgbouncer",
            "pending",
            pool.cl_waiting || 0,
          );

          // Calculate pool saturation
          const totalConnections =
            (pool.cl_active || 0) + (pool.cl_waiting || 0);
          const saturation = Math.min(
            totalConnections / this.poolLimits.pgbouncer.default_pool_size,
            1.0,
          );

          TelemetryMetrics.setDbPoolSaturation("pgbouncer", saturation);

          // Log warnings if pool is saturated
          if (saturation > 0.8) {
            this.logger.warn(
              `PgBouncer pool saturation high: ${(saturation * 100).toFixed(1)}% ` +
                `(${totalConnections}/${this.poolLimits.pgbouncer.default_pool_size} connections)`,
            );
          }

          if ((pool.cl_waiting || 0) > 0) {
            this.logger.warn(
              `PgBouncer has ${pool.cl_waiting} clients waiting in queue`,
            );
          }
        }
      }

      // Query PgBouncer SHOW STATS for query timing and queue wait
      const stats = await prisma.$queryRaw<any[]>`SHOW STATS`;

      if (stats && stats.length > 0) {
        for (const stat of stats) {
          // avg_query_time is in microseconds in PgBouncer
          const avgQueryMs = (stat.avg_query_time || 0) / 1000;
          const avgWaitMs = (stat.avg_wait_time || 0) / 1000;

          if (avgQueryMs > 0) {
            TelemetryMetrics.observeDbTransactionDuration(
              "pgbouncer",
              "avg",
              avgQueryMs,
            );
          }

          if (avgWaitMs > 0) {
            TelemetryMetrics.observeDbQueueWait("pgbouncer", avgWaitMs);
          }

          // Log warnings for high latency
          if (avgWaitMs > 100) {
            this.logger.warn(
              `High queue wait time: ${avgWaitMs.toFixed(1)}ms - ` +
                `pool may be undersized or queries are slow`,
            );
          }

          if (avgQueryMs > 500) {
            this.logger.warn(
              `High average query time: ${avgQueryMs.toFixed(1)}ms - ` +
                `consider query optimization or indexing`,
            );
          }
        }
      }
    } catch (error) {
      const err = error as Error;

      // Don't log error if SHOW POOLS/STATS not supported (direct connection)
      if (err.message.includes("unrecognized configuration parameter")) {
        this.logger.debug(
          "Database metrics collection requires PgBouncer connection",
        );
      } else if (err.message.includes('syntax error at or near "SHOW"')) {
        this.logger.debug(
          "SHOW POOLS/STATS not available - likely direct PostgreSQL connection",
        );
      } else {
        this.logger.error(`Failed to collect DB pool metrics: ${err.message}`);
      }
    }
  }

  /**
   * Get current pool saturation for health checks
   */
  async getPoolSaturation(): Promise<number> {
    try {
      const prisma = getPrismaClient();
      const pools = await prisma.$queryRaw<any[]>`SHOW POOLS`;

      if (!pools || pools.length === 0) {
        return 0;
      }

      const pool = pools[0];
      const totalConnections = (pool.cl_active || 0) + (pool.cl_waiting || 0);
      return Math.min(
        totalConnections / this.poolLimits.pgbouncer.default_pool_size,
        1.0,
      );
    } catch {
      return 0;
    }
  }

  /**
   * Get current queue wait time for health checks
   */
  async getAvgQueueWait(): Promise<number> {
    try {
      const prisma = getPrismaClient();
      const stats = await prisma.$queryRaw<any[]>`SHOW STATS`;

      if (!stats || stats.length === 0) {
        return 0;
      }

      const stat = stats[0];
      return (stat.avg_wait_time || 0) / 1000; // Convert to milliseconds
    } catch {
      return 0;
    }
  }

  /**
   * Check if pool is healthy (not saturated or queuing)
   */
  async isPoolHealthy(): Promise<boolean> {
    const saturation = await this.getPoolSaturation();
    const queueWait = await this.getAvgQueueWait();

    // Pool is unhealthy if:
    // - Saturation > 90%
    // - Average queue wait > 500ms
    return saturation < 0.9 && queueWait < 500;
  }
}
