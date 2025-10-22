import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TelemetryMetrics } from "../../observability/metrics-registry";

/**
 * VacuumHealthMonitor
 *
 * Monitors PostgreSQL vacuum health, bloat, and statistics freshness.
 *
 * WHAT IT TRACKS:
 * 1. Dead Tuples: Count of dead rows awaiting vacuum
 * 2. Vacuum Lag: Time since last vacuum
 * 3. Analyze Lag: Time since last statistics update
 * 4. Bloat Ratio: Estimated wasted space percentage
 * 5. Autovacuum Activity: Currently running vacuums
 *
 * WHY IT MATTERS:
 * - Dead tuples waste space and slow sequential scans
 * - Stale statistics cause query planner to choose inefficient plans
 * - Bloat increases I/O costs and degrades cache efficiency
 * - Vacuum lag indicates autovacuum falling behind write rate
 *
 * BLOAT ESTIMATION:
 * Uses pgstattuple extension when available, falls back to heuristic:
 *   bloat_ratio = dead_tuples / (live_tuples + dead_tuples)
 *
 * THRESHOLDS:
 * - Dead tuples warning: > 10% of table size
 * - Vacuum lag warning: > 24 hours
 * - Analyze lag warning: > 7 days
 * - Bloat warning: > 20%
 * - Bloat critical: > 30%
 *
 * METRICS EMITTED:
 * - table_dead_tuples{table, schema} - Gauge
 * - table_bloat_ratio{table, schema} - Gauge (0-1)
 * - vacuum_lag_seconds{table, schema} - Gauge
 * - analyze_lag_seconds{table, schema} - Gauge
 * - autovacuum_running{table, schema} - Gauge (0/1)
 *
 * @see AutovacuumConfigService for tuning settings
 * @see DATABASE_HEALTH_PLAYBOOK.md for maintenance procedures
 */

export interface TableVacuumStats {
  tableName: string;
  schemaName: string;
  liveRowCount: number;
  deadRowCount: number;
  lastVacuum: Date | null;
  lastAutoVacuum: Date | null;
  lastAnalyze: Date | null;
  lastAutoAnalyze: Date | null;
  vacuumCount: number;
  autoVacuumCount: number;
  analyzeCount: number;
  autoAnalyzeCount: number;
  vacuumLagSeconds: number | null;
  analyzeLagSeconds: number | null;
  bloatRatio: number | null; // 0-1
  autovacuumRunning: boolean;
}

export interface BloatEstimate {
  tableName: string;
  schemaName: string;
  tableSize: number; // bytes
  bloatSize: number; // bytes
  bloatRatio: number; // 0-1
  deadTupleCount: number;
  deadTupleSize: number; // bytes
}

export interface VacuumHealthSummary {
  totalTables: number;
  tablesNeedingVacuum: string[];
  tablesNeedingAnalyze: string[];
  tablesWithHighBloat: string[];
  autovacuumsRunning: number;
  oldestVacuumLag: number | null; // seconds
  oldestAnalyzeLag: number | null; // seconds
  totalDeadTuples: number;
  averageBloatRatio: number;
}

@Injectable()
export class VacuumHealthMonitor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VacuumHealthMonitor.name);
  private pollInterval: NodeJS.Timeout | null = null;

  /** Polling interval in milliseconds (default: 60 seconds) */
  private readonly POLL_INTERVAL_MS = parseInt(
    process.env.VACUUM_POLL_INTERVAL || "60000",
    10,
  );

  /** Tables to monitor (empty = all tables) */
  private readonly MONITORED_TABLES = process.env.MONITORED_TABLES
    ? process.env.MONITORED_TABLES.split(",")
    : [
        "Message",
        "MessageReadReceipt",
        "Conversation",
        "ConversationParticipant",
        "User",
      ];

  /** Warning thresholds */
  private readonly THRESHOLDS = {
    deadTuplesPercentage: 0.1, // 10% of table size
    vacuumLagSeconds: 24 * 3600, // 24 hours
    analyzeLagSeconds: 7 * 24 * 3600, // 7 days
    bloatWarning: 0.2, // 20%
    bloatCritical: 0.3, // 30%
  };

  /** Cache of last stats for each table */
  private lastStats = new Map<string, TableVacuumStats>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    this.logger.log("VacuumHealthMonitor initialized");
    this.logger.log(`Polling every ${this.POLL_INTERVAL_MS / 1000}s`);
    this.logger.log(`Monitoring tables: ${this.MONITORED_TABLES.join(", ")}`);

    // Initial poll
    await this.pollVacuumStats();

    // Start periodic polling
    this.pollInterval = setInterval(
      () => this.pollVacuumStats(),
      this.POLL_INTERVAL_MS,
    );
  }

  async onModuleDestroy() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Poll pg_stat_user_tables for vacuum and analyze statistics
   */
  private async pollVacuumStats(): Promise<void> {
    try {
      const stats = await this.fetchVacuumStats();

      for (const stat of stats) {
        const key = `${stat.schemaName}.${stat.tableName}`;
        this.lastStats.set(key, stat);

        // Emit metrics
        this.emitTableMetrics(stat);

        // Log warnings
        this.checkThresholds(stat);
      }

      // Log summary
      const summary = this.getSummary();
      this.logger.debug(
        `Vacuum health: ${summary.totalTables} tables, ` +
          `${summary.tablesNeedingVacuum.length} need vacuum, ` +
          `${summary.tablesNeedingAnalyze.length} need analyze, ` +
          `${summary.tablesWithHighBloat.length} high bloat`,
      );
    } catch (error) {
      this.logger.error("Failed to poll vacuum stats", error);
    }
  }

  /**
   * Fetch vacuum statistics from pg_stat_user_tables
   */
  private async fetchVacuumStats(): Promise<TableVacuumStats[]> {
    const tableFilter =
      this.MONITORED_TABLES.length > 0
        ? `AND relname = ANY(ARRAY[${this.MONITORED_TABLES.map((t) => `'${t}'`).join(",")}]::text[])`
        : "";

    const query = `
      SELECT
        schemaname,
        relname AS tablename,
        n_live_tup AS live_tuples,
        n_dead_tup AS dead_tuples,
        last_vacuum,
        last_autovacuum,
        last_analyze,
        last_autoanalyze,
        vacuum_count,
        autovacuum_count,
        analyze_count,
        autoanalyze_count,
        EXTRACT(EPOCH FROM (NOW() - GREATEST(last_vacuum, last_autovacuum)))::integer AS vacuum_lag_seconds,
        EXTRACT(EPOCH FROM (NOW() - GREATEST(last_analyze, last_autoanalyze)))::integer AS analyze_lag_seconds
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
        ${tableFilter}
      ORDER BY n_dead_tup DESC;
    `;

    const result: any[] = await this.prisma.$queryRawUnsafe(query);

    // Check for currently running autovacuums
    const runningVacuums = await this.fetchRunningVacuums();

    return result.map((row) => ({
      tableName: row.tablename,
      schemaName: row.schemaname,
      liveRowCount: parseInt(row.live_tuples, 10) || 0,
      deadRowCount: parseInt(row.dead_tuples, 10) || 0,
      lastVacuum: row.last_vacuum,
      lastAutoVacuum: row.last_autovacuum,
      lastAnalyze: row.last_analyze,
      lastAutoAnalyze: row.last_autoanalyze,
      vacuumCount: parseInt(row.vacuum_count, 10) || 0,
      autoVacuumCount: parseInt(row.autovacuum_count, 10) || 0,
      analyzeCount: parseInt(row.analyze_count, 10) || 0,
      autoAnalyzeCount: parseInt(row.autoanalyze_count, 10) || 0,
      vacuumLagSeconds: row.vacuum_lag_seconds,
      analyzeLagSeconds: row.analyze_lag_seconds,
      bloatRatio: this.estimateBloatRatio(
        parseInt(row.live_tuples, 10) || 0,
        parseInt(row.dead_tuples, 10) || 0,
      ),
      autovacuumRunning: runningVacuums.includes(row.tablename),
    }));
  }

  /**
   * Fetch currently running autovacuum processes
   */
  private async fetchRunningVacuums(): Promise<string[]> {
    try {
      const query = `
        SELECT
          REGEXP_REPLACE(query, '.*"(.*)".*', '\\1') AS tablename
        FROM pg_stat_activity
        WHERE query LIKE 'autovacuum:%'
          AND state = 'active';
      `;

      const result: Array<{ tablename: string }> =
        await this.prisma.$queryRawUnsafe(query);
      return result.map((r) => r.tablename);
    } catch (error) {
      this.logger.warn("Failed to fetch running vacuums", error);
      return [];
    }
  }

  /**
   * Estimate bloat ratio using simple heuristic
   *
   * More accurate estimation requires pgstattuple extension:
   *   SELECT * FROM pgstattuple('table_name');
   *
   * This heuristic assumes:
   * - Dead tuples represent bloat
   * - No fillfactor configured (default 100%)
   */
  private estimateBloatRatio(liveTuples: number, deadTuples: number): number {
    const total = liveTuples + deadTuples;
    if (total === 0) return 0;

    return deadTuples / total;
  }

  /**
   * Fetch detailed bloat estimates using pgstattuple extension (if available)
   */
  async fetchDetailedBloatEstimates(): Promise<BloatEstimate[]> {
    try {
      // Check if pgstattuple extension exists
      const extensionExists = await this.prisma.$queryRaw<
        Array<{ exists: boolean }>
      >`
        SELECT EXISTS (
          SELECT 1 FROM pg_extension WHERE extname = 'pgstattuple'
        ) AS exists;
      `;

      if (!extensionExists[0]?.exists) {
        this.logger.debug(
          "pgstattuple extension not available, using heuristic bloat estimates",
        );
        return this.fetchHeuristicBloatEstimates();
      }

      // Use pgstattuple for accurate bloat measurement
      const estimates: BloatEstimate[] = [];

      for (const tableName of this.MONITORED_TABLES) {
        try {
          const result: any[] = await this.prisma.$queryRawUnsafe(`
            SELECT
              '${tableName}' AS tablename,
              'public' AS schemaname,
              table_len AS table_size,
              dead_tuple_len AS dead_tuple_size,
              dead_tuple_count,
              CASE
                WHEN table_len > 0 THEN dead_tuple_len::float / table_len::float
                ELSE 0
              END AS bloat_ratio
            FROM pgstattuple('public."${tableName}"');
          `);

          if (result[0]) {
            estimates.push({
              tableName: result[0].tablename,
              schemaName: result[0].schemaname,
              tableSize: parseInt(result[0].table_size, 10),
              bloatSize: parseInt(result[0].dead_tuple_size, 10),
              bloatRatio: parseFloat(result[0].bloat_ratio),
              deadTupleCount: parseInt(result[0].dead_tuple_count, 10),
              deadTupleSize: parseInt(result[0].dead_tuple_size, 10),
            });
          }
        } catch (error) {
          this.logger.warn(
            `Failed to get bloat estimate for ${tableName}`,
            error,
          );
        }
      }

      return estimates;
    } catch (error) {
      this.logger.error("Failed to fetch detailed bloat estimates", error);
      return this.fetchHeuristicBloatEstimates();
    }
  }

  /**
   * Fallback heuristic bloat estimates based on dead tuples
   */
  private async fetchHeuristicBloatEstimates(): Promise<BloatEstimate[]> {
    const estimates: BloatEstimate[] = [];

    for (const stat of this.lastStats.values()) {
      if (!this.MONITORED_TABLES.includes(stat.tableName)) continue;

      // Estimate: assume average row size of 500 bytes
      const avgRowSize = 500;
      const tableSize = (stat.liveRowCount + stat.deadRowCount) * avgRowSize;
      const deadTupleSize = stat.deadRowCount * avgRowSize;

      estimates.push({
        tableName: stat.tableName,
        schemaName: stat.schemaName,
        tableSize,
        bloatSize: deadTupleSize,
        bloatRatio: stat.bloatRatio || 0,
        deadTupleCount: stat.deadRowCount,
        deadTupleSize,
      });
    }

    return estimates;
  }

  /**
   * Emit Prometheus metrics for a table
   */
  private emitTableMetrics(stat: TableVacuumStats): void {
    const labels = {
      table: stat.tableName,
      schema: stat.schemaName,
    };

    // Dead tuples
    TelemetryMetrics.setTableDeadTuples(
      stat.deadRowCount,
      labels.table,
      labels.schema,
    );

    // Bloat ratio
    if (stat.bloatRatio !== null) {
      TelemetryMetrics.setTableBloatRatio(
        stat.bloatRatio,
        labels.table,
        labels.schema,
      );
    }

    // Vacuum lag
    if (stat.vacuumLagSeconds !== null) {
      TelemetryMetrics.setVacuumLagSeconds(
        stat.vacuumLagSeconds,
        labels.table,
        labels.schema,
      );
    }

    // Analyze lag
    if (stat.analyzeLagSeconds !== null) {
      TelemetryMetrics.setAnalyzeLagSeconds(
        stat.analyzeLagSeconds,
        labels.table,
        labels.schema,
      );
    }

    // Autovacuum running
    TelemetryMetrics.setAutovacuumRunning(
      stat.autovacuumRunning ? 1 : 0,
      labels.table,
      labels.schema,
    );
  }

  /**
   * Check thresholds and log warnings
   */
  private checkThresholds(stat: TableVacuumStats): void {
    const totalTuples = stat.liveRowCount + stat.deadRowCount;

    // Dead tuples warning
    if (totalTuples > 0) {
      const deadPercentage = stat.deadRowCount / totalTuples;
      if (deadPercentage > this.THRESHOLDS.deadTuplesPercentage) {
        this.logger.warn(
          `Table ${stat.tableName} has ${(deadPercentage * 100).toFixed(1)}% dead tuples ` +
            `(${stat.deadRowCount.toLocaleString()} of ${totalTuples.toLocaleString()})`,
        );
      }
    }

    // Vacuum lag warning
    if (
      stat.vacuumLagSeconds !== null &&
      stat.vacuumLagSeconds > this.THRESHOLDS.vacuumLagSeconds
    ) {
      const lagHours = Math.round(stat.vacuumLagSeconds / 3600);
      this.logger.warn(
        `Table ${stat.tableName} last vacuum was ${lagHours} hours ago ` +
          `(threshold: ${this.THRESHOLDS.vacuumLagSeconds / 3600} hours)`,
      );
    }

    // Analyze lag warning
    if (
      stat.analyzeLagSeconds !== null &&
      stat.analyzeLagSeconds > this.THRESHOLDS.analyzeLagSeconds
    ) {
      const lagDays = Math.round(stat.analyzeLagSeconds / 86400);
      this.logger.warn(
        `Table ${stat.tableName} last analyze was ${lagDays} days ago ` +
          `(threshold: ${this.THRESHOLDS.analyzeLagSeconds / 86400} days)`,
      );
    }

    // Bloat warning
    if (stat.bloatRatio !== null) {
      if (stat.bloatRatio > this.THRESHOLDS.bloatCritical) {
        this.logger.error(
          `CRITICAL: Table ${stat.tableName} has ${(stat.bloatRatio * 100).toFixed(1)}% bloat ` +
            `(threshold: ${this.THRESHOLDS.bloatCritical * 100}%). Consider manual VACUUM FULL or pg_repack.`,
        );
      } else if (stat.bloatRatio > this.THRESHOLDS.bloatWarning) {
        this.logger.warn(
          `Table ${stat.tableName} has ${(stat.bloatRatio * 100).toFixed(1)}% bloat ` +
            `(threshold: ${this.THRESHOLDS.bloatWarning * 100}%)`,
        );
      }
    }
  }

  /**
   * Get summary of vacuum health across all monitored tables
   */
  getSummary(): VacuumHealthSummary {
    const stats = Array.from(this.lastStats.values());

    const tablesNeedingVacuum = stats
      .filter((s) => {
        const total = s.liveRowCount + s.deadRowCount;
        return (
          total > 0 &&
          s.deadRowCount / total > this.THRESHOLDS.deadTuplesPercentage
        );
      })
      .map((s) => s.tableName);

    const tablesNeedingAnalyze = stats
      .filter(
        (s) =>
          s.analyzeLagSeconds !== null &&
          s.analyzeLagSeconds > this.THRESHOLDS.analyzeLagSeconds,
      )
      .map((s) => s.tableName);

    const tablesWithHighBloat = stats
      .filter(
        (s) =>
          s.bloatRatio !== null && s.bloatRatio > this.THRESHOLDS.bloatWarning,
      )
      .map((s) => s.tableName);

    const autovacuumsRunning = stats.filter((s) => s.autovacuumRunning).length;

    const oldestVacuumLag =
      Math.max(...stats.map((s) => s.vacuumLagSeconds || 0), 0) || null;

    const oldestAnalyzeLag =
      Math.max(...stats.map((s) => s.analyzeLagSeconds || 0), 0) || null;

    const totalDeadTuples = stats.reduce((sum, s) => sum + s.deadRowCount, 0);

    const averageBloatRatio =
      stats.length > 0
        ? stats.reduce((sum, s) => sum + (s.bloatRatio || 0), 0) / stats.length
        : 0;

    return {
      totalTables: stats.length,
      tablesNeedingVacuum,
      tablesNeedingAnalyze,
      tablesWithHighBloat,
      autovacuumsRunning,
      oldestVacuumLag,
      oldestAnalyzeLag,
      totalDeadTuples,
      averageBloatRatio,
    };
  }

  /**
   * Get vacuum statistics for a specific table
   */
  getTableStats(tableName: string): TableVacuumStats | undefined {
    for (const [key, stat] of this.lastStats.entries()) {
      if (stat.tableName === tableName) {
        return stat;
      }
    }
    return undefined;
  }

  /**
   * Force immediate vacuum statistics poll (for testing/debugging)
   */
  async forcePoll(): Promise<void> {
    await this.pollVacuumStats();
  }
}
