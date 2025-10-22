import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * AutovacuumConfigService
 *
 * Manages PostgreSQL autovacuum configuration for high-churn tables.
 *
 * STRATEGY:
 * - Hot tables (messages, messageReadReceipts): Aggressive autovacuum
 * - Medium tables (conversations, users): Balanced settings
 * - Cold tables (sessions): Default PostgreSQL settings
 *
 * KEY TUNING PARAMETERS:
 * 1. autovacuum_vacuum_scale_factor: Percentage of table size triggering vacuum
 *    - Hot: 0.05 (5%) - vacuum when 5% of rows are dead
 *    - Medium: 0.10 (10%)
 *    - Cold: 0.20 (default)
 *
 * 2. autovacuum_vacuum_cost_limit: I/O budget per cycle
 *    - Hot: 2000 (4x default) - faster vacuum completion
 *    - Medium: 1000 (2x default)
 *    - Cold: 500 (default)
 *
 * 3. autovacuum_analyze_scale_factor: Percentage triggering statistics update
 *    - Hot: 0.02 (2%) - keep planner stats fresh
 *    - Medium: 0.05 (5%)
 *    - Cold: 0.10 (default)
 *
 * RATIONALE:
 * - Messages table: High insert/update rate (1000+ TPS), needs frequent vacuum
 * - MessageReadReceipts: High churn from read tracking, aggressive analyze for JOIN plans
 * - Conversations: Moderate churn from metadata updates
 *
 * MONITORING:
 * Tracks vacuum/analyze lag, bloat estimates, dead tuple counts
 *
 * @see VacuumHealthMonitor for runtime monitoring
 * @see DATABASE_HEALTH_PLAYBOOK.md for maintenance procedures
 */

export interface AutovacuumSettings {
  /** Table name */
  tableName: string;

  /** Workload classification */
  workloadClass: "hot" | "medium" | "cold";

  /** Autovacuum vacuum scale factor (0-1) */
  vacuumScaleFactor: number;

  /** Autovacuum vacuum threshold (min dead tuples) */
  vacuumThreshold: number;

  /** Autovacuum analyze scale factor (0-1) */
  analyzeScaleFactor: number;

  /** Autovacuum analyze threshold (min changed tuples) */
  analyzeThreshold: number;

  /** Autovacuum vacuum cost limit (I/O budget) */
  vacuumCostLimit: number;

  /** Autovacuum vacuum cost delay (ms) */
  vacuumCostDelay: number;

  /** Expected write rate (rows/sec) */
  expectedWriteRate?: number;

  /** Rationale for settings */
  rationale?: string;
}

@Injectable()
export class AutovacuumConfigService implements OnModuleInit {
  private readonly logger = new Logger(AutovacuumConfigService.name);

  /** Default PostgreSQL autovacuum settings (baseline) */
  private readonly DEFAULT_SETTINGS = {
    vacuumScaleFactor: 0.2,
    vacuumThreshold: 50,
    analyzeScaleFactor: 0.1,
    analyzeThreshold: 50,
    vacuumCostLimit: 500,
    vacuumCostDelay: 2,
  };

  /** Table-specific autovacuum configurations */
  private readonly TABLE_CONFIGS: AutovacuumSettings[] = [
    {
      tableName: "Message",
      workloadClass: "hot",
      vacuumScaleFactor: 0.05,
      vacuumThreshold: 100,
      analyzeScaleFactor: 0.02,
      analyzeThreshold: 100,
      vacuumCostLimit: 2000,
      vacuumCostDelay: 2,
      expectedWriteRate: 1000, // 1000 inserts/sec peak
      rationale:
        "High message throughput (1000+ TPS) requires aggressive vacuum to prevent bloat. " +
        "Frequent analyze keeps JOIN selectivity estimates accurate for conversation queries.",
    },
    {
      tableName: "MessageReadReceipt",
      workloadClass: "hot",
      vacuumScaleFactor: 0.05,
      vacuumThreshold: 100,
      analyzeScaleFactor: 0.02,
      analyzeThreshold: 100,
      vacuumCostLimit: 2000,
      vacuumCostDelay: 2,
      expectedWriteRate: 2000, // 2x message rate (multiple recipients)
      rationale:
        "Extremely high churn from read tracking. Aggressive settings prevent bloat affecting " +
        "unread count queries. Fresh stats critical for efficient GROUP BY plans.",
    },
    {
      tableName: "Conversation",
      workloadClass: "medium",
      vacuumScaleFactor: 0.1,
      vacuumThreshold: 75,
      analyzeScaleFactor: 0.05,
      analyzeThreshold: 75,
      vacuumCostLimit: 1000,
      vacuumCostDelay: 2,
      expectedWriteRate: 200, // Metadata updates
      rationale:
        "Moderate update rate from lastMessageAt, unreadCount updates. " +
        "Balanced settings maintain query performance without excessive I/O.",
    },
    {
      tableName: "ConversationParticipant",
      workloadClass: "medium",
      vacuumScaleFactor: 0.1,
      vacuumThreshold: 75,
      analyzeScaleFactor: 0.05,
      analyzeThreshold: 75,
      vacuumCostLimit: 1000,
      vacuumCostDelay: 2,
      expectedWriteRate: 100, // Join/leave events
      rationale:
        "Moderate churn from users joining/leaving conversations. " +
        "Stats accuracy important for participant filtering in conversation lists.",
    },
    {
      tableName: "User",
      workloadClass: "medium",
      vacuumScaleFactor: 0.1,
      vacuumThreshold: 50,
      analyzeScaleFactor: 0.05,
      analyzeThreshold: 50,
      vacuumCostLimit: 800,
      vacuumCostDelay: 2,
      expectedWriteRate: 50, // Profile updates, lastSeen
      rationale:
        "Low-moderate write rate from profile updates and activity tracking. " +
        "Balanced settings sufficient for steady-state performance.",
    },
    {
      tableName: "Session",
      workloadClass: "cold",
      vacuumScaleFactor: 0.2,
      vacuumThreshold: 50,
      analyzeScaleFactor: 0.1,
      analyzeThreshold: 50,
      vacuumCostLimit: 500,
      vacuumCostDelay: 2,
      expectedWriteRate: 10, // Session creates/expires
      rationale:
        "Low churn rate. Default PostgreSQL settings appropriate. " +
        "Vacuum primarily handles expired session cleanup.",
    },
  ];

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    this.logger.log("AutovacuumConfigService initialized");
    this.logger.log(
      `Managing autovacuum for ${this.TABLE_CONFIGS.length} tables`,
    );

    // Log current configuration for audit trail
    for (const config of this.TABLE_CONFIGS) {
      this.logger.debug(
        `Table ${config.tableName} [${config.workloadClass}]: ` +
          `vacuum_scale=${config.vacuumScaleFactor}, ` +
          `analyze_scale=${config.analyzeScaleFactor}, ` +
          `cost_limit=${config.vacuumCostLimit}`,
      );
    }
  }

  /**
   * Get autovacuum configuration for a table
   */
  getTableConfig(tableName: string): AutovacuumSettings | undefined {
    return this.TABLE_CONFIGS.find((c) => c.tableName === tableName);
  }

  /**
   * Get all hot tables requiring aggressive autovacuum
   */
  getHotTables(): AutovacuumSettings[] {
    return this.TABLE_CONFIGS.filter((c) => c.workloadClass === "hot");
  }

  /**
   * Generate SQL ALTER TABLE statements for applying autovacuum settings
   *
   * @returns SQL migration script as string
   */
  generateMigrationSQL(): string {
    const statements: string[] = [
      "-- Autovacuum Configuration Migration",
      "-- Generated: " + new Date().toISOString(),
      "-- Purpose: Tune autovacuum for high-churn tables to prevent bloat and stale statistics",
      "",
      "-- IMPORTANT: Apply during low-traffic window",
      "-- ROLLBACK: Settings can be reset with: ALTER TABLE <name> RESET (autovacuum_*))",
      "",
      "-- Global autovacuum settings (already configured at database level)",
      "-- autovacuum = on",
      "-- autovacuum_max_workers = 3",
      "-- autovacuum_naptime = 10s (check interval)",
      "",
      "-- Table-specific overrides",
      "",
    ];

    for (const config of this.TABLE_CONFIGS) {
      statements.push(
        `-- ${config.tableName} [${config.workloadClass.toUpperCase()}]`,
      );
      statements.push(`-- ${config.rationale}`);
      statements.push(
        `-- Expected write rate: ${config.expectedWriteRate || "N/A"} rows/sec`,
      );

      const options = [
        `autovacuum_vacuum_scale_factor = ${config.vacuumScaleFactor}`,
        `autovacuum_vacuum_threshold = ${config.vacuumThreshold}`,
        `autovacuum_analyze_scale_factor = ${config.analyzeScaleFactor}`,
        `autovacuum_analyze_threshold = ${config.analyzeThreshold}`,
        `autovacuum_vacuum_cost_limit = ${config.vacuumCostLimit}`,
        `autovacuum_vacuum_cost_delay = ${config.vacuumCostDelay}`,
      ];

      statements.push(
        `ALTER TABLE "${config.tableName}" SET (\n  ${options.join(",\n  ")}\n);`,
      );
      statements.push("");
    }

    statements.push("-- Verify settings");
    statements.push("SELECT schemaname, tablename, reloptions");
    statements.push("FROM pg_tables");
    statements.push("WHERE schemaname = 'public'");
    statements.push("  AND reloptions IS NOT NULL");
    statements.push("ORDER BY tablename;");
    statements.push("");

    statements.push("-- Force immediate analyze to refresh statistics");
    for (const config of this.TABLE_CONFIGS) {
      statements.push(`ANALYZE "${config.tableName}";`);
    }

    return statements.join("\n");
  }

  /**
   * Generate SQL to reset autovacuum settings to defaults (rollback)
   */
  generateRollbackSQL(): string {
    const statements: string[] = [
      "-- Autovacuum Configuration Rollback",
      "-- Generated: " + new Date().toISOString(),
      "-- Purpose: Reset autovacuum settings to PostgreSQL defaults",
      "",
    ];

    for (const config of this.TABLE_CONFIGS) {
      statements.push(`-- Reset ${config.tableName}`);
      statements.push(`ALTER TABLE "${config.tableName}" RESET (`);
      statements.push("  autovacuum_vacuum_scale_factor,");
      statements.push("  autovacuum_vacuum_threshold,");
      statements.push("  autovacuum_analyze_scale_factor,");
      statements.push("  autovacuum_analyze_threshold,");
      statements.push("  autovacuum_vacuum_cost_limit,");
      statements.push("  autovacuum_vacuum_cost_delay");
      statements.push(");");
      statements.push("");
    }

    return statements.join("\n");
  }

  /**
   * Calculate recommended vacuum threshold for a table based on size and write rate
   *
   * @param tableSize Current table size in rows
   * @param writeRate Expected write rate in rows/sec
   * @returns Recommended scale factor and threshold
   */
  calculateRecommendedSettings(
    tableSize: number,
    writeRate: number,
  ): Pick<
    AutovacuumSettings,
    "vacuumScaleFactor" | "vacuumThreshold" | "analyzeScaleFactor"
  > {
    // High write rate (>500 TPS): Aggressive settings
    if (writeRate > 500) {
      return {
        vacuumScaleFactor: 0.05,
        vacuumThreshold: 100,
        analyzeScaleFactor: 0.02,
      };
    }

    // Medium write rate (100-500 TPS): Balanced settings
    if (writeRate > 100) {
      return {
        vacuumScaleFactor: 0.1,
        vacuumThreshold: 75,
        analyzeScaleFactor: 0.05,
      };
    }

    // Low write rate (<100 TPS): Default settings
    return {
      vacuumScaleFactor: 0.2,
      vacuumThreshold: 50,
      analyzeScaleFactor: 0.1,
    };
  }

  /**
   * Estimate time until next autovacuum for a table
   *
   * @param tableName Table name
   * @param currentDeadTuples Current dead tuple count
   * @param liveRowCount Current live row count
   * @param writeRate Write rate in rows/sec
   * @returns Estimated seconds until autovacuum triggers, or null if already triggered
   */
  estimateTimeToNextVacuum(
    tableName: string,
    currentDeadTuples: number,
    liveRowCount: number,
    writeRate: number,
  ): number | null {
    const config = this.getTableConfig(tableName);
    if (!config) {
      this.logger.warn(`No autovacuum config found for table ${tableName}`);
      return null;
    }

    // Autovacuum triggers when: dead_tuples > (threshold + scale_factor * live_tuples)
    const triggerThreshold =
      config.vacuumThreshold + config.vacuumScaleFactor * liveRowCount;

    // Already needs vacuum
    if (currentDeadTuples >= triggerThreshold) {
      return 0;
    }

    // Estimate time until threshold reached
    const deadTuplesNeeded = triggerThreshold - currentDeadTuples;

    // Assume 50% of writes create dead tuples (updates/deletes)
    const deadTupleRate = writeRate * 0.5;

    if (deadTupleRate <= 0) {
      return null; // No writes, won't trigger
    }

    const secondsUntilVacuum = Math.ceil(deadTuplesNeeded / deadTupleRate);
    return secondsUntilVacuum;
  }

  /**
   * Check if autovacuum is enabled at database level
   */
  async checkAutovacuumEnabled(): Promise<boolean> {
    try {
      const result = await this.prisma.$queryRaw<Array<{ autovacuum: string }>>`
        SHOW autovacuum;
      `;

      return result[0]?.autovacuum === "on";
    } catch (error) {
      this.logger.error("Failed to check autovacuum status", error);
      return false;
    }
  }

  /**
   * Get current autovacuum settings for a table from PostgreSQL
   */
  async getCurrentTableSettings(
    tableName: string,
  ): Promise<Record<string, any> | null> {
    try {
      const result = await this.prisma.$queryRaw<
        Array<{ reloptions: string[] }>
      >`
        SELECT reloptions
        FROM pg_class
        WHERE relname = ${tableName}
          AND relkind = 'r';
      `;

      if (!result[0]?.reloptions) {
        return null; // Using defaults
      }

      // Parse reloptions array: ["autovacuum_vacuum_scale_factor=0.05", ...]
      const settings: Record<string, any> = {};
      for (const option of result[0].reloptions) {
        const [key, value] = option.split("=");
        settings[key] = value;
      }

      return settings;
    } catch (error) {
      this.logger.error(`Failed to get settings for table ${tableName}`, error);
      return null;
    }
  }

  /**
   * Generate configuration summary for documentation
   */
  generateConfigSummary(): string {
    const lines: string[] = [
      "# Autovacuum Configuration Summary",
      "",
      "## Overview",
      "",
      `Total tables configured: ${this.TABLE_CONFIGS.length}`,
      `Hot tables: ${this.getHotTables().length}`,
      "",
      "## Table Configurations",
      "",
    ];

    for (const config of this.TABLE_CONFIGS) {
      lines.push(
        `### ${config.tableName} [${config.workloadClass.toUpperCase()}]`,
      );
      lines.push("");
      lines.push(
        `**Write Rate**: ${config.expectedWriteRate || "N/A"} rows/sec`,
      );
      lines.push("");
      lines.push(`**Settings**:`);
      lines.push(
        `- Vacuum Scale Factor: ${config.vacuumScaleFactor} (${config.vacuumScaleFactor * 100}%)`,
      );
      lines.push(`- Vacuum Threshold: ${config.vacuumThreshold} dead tuples`);
      lines.push(
        `- Analyze Scale Factor: ${config.analyzeScaleFactor} (${config.analyzeScaleFactor * 100}%)`,
      );
      lines.push(
        `- Analyze Threshold: ${config.analyzeThreshold} changed tuples`,
      );
      lines.push(
        `- Vacuum Cost Limit: ${config.vacuumCostLimit} (${Math.round((config.vacuumCostLimit / 500) * 100)}% of default)`,
      );
      lines.push("");
      lines.push(`**Rationale**: ${config.rationale}`);
      lines.push("");

      // Calculate example trigger points for different table sizes
      const exampleSizes = [10000, 100000, 1000000];
      lines.push("**Vacuum Triggers At**:");
      for (const size of exampleSizes) {
        const trigger =
          config.vacuumThreshold + config.vacuumScaleFactor * size;
        lines.push(
          `- ${size.toLocaleString()} rows → ${Math.round(trigger).toLocaleString()} dead tuples`,
        );
      }
      lines.push("");
    }

    lines.push("## Comparison to Defaults");
    lines.push("");
    lines.push("| Metric | Hot Tables | Medium Tables | Default (Cold) |");
    lines.push("|--------|------------|---------------|----------------|");
    lines.push(`| Vacuum Scale | 5% | 10% | 20% |`);
    lines.push(`| Analyze Scale | 2% | 5% | 10% |`);
    lines.push(`| Cost Limit | 2000 (4x) | 1000 (2x) | 500 (1x) |`);
    lines.push("");

    return lines.join("\n");
  }
}
