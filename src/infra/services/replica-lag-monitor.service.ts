import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { PrismaReadReplicaService } from "./prisma-read-replica.service";
import { TelemetryMetrics } from "../../observability/metrics-registry";

/**
 * ReplicaLagMonitor
 *
 * Monitors replication lag between primary and replica databases.
 * Queries pg_stat_replication on the primary to get lag metrics.
 *
 * Metrics Emitted:
 * - replica_lag_seconds: Current replication lag in seconds
 * - replica_health: 1 if healthy, 0 if unhealthy
 * - replica_lag_bytes: Byte lag between primary and replica
 *
 * Thresholds:
 * - Warning: lag > 5 seconds (default)
 * - Critical: lag > 10 seconds
 * - Unavailable: metric cannot be collected
 *
 * Polling Interval: 10 seconds (configurable via REPLICA_LAG_POLL_INTERVAL)
 */
@Injectable()
export class ReplicaLagMonitor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReplicaLagMonitor.name);

  private pollTimer: NodeJS.Timeout | null = null;
  private readonly enabled: boolean;
  private readonly pollInterval: number;
  private readonly warningThreshold: number;
  private readonly criticalThreshold: number;

  // Current lag state
  private currentLagSeconds: number | null = null;
  private lastSuccessfulPoll: Date | null = null;
  private consecutiveFailures = 0;

  constructor(private readonly replicaService: PrismaReadReplicaService) {
    this.enabled = process.env.ENABLE_READ_REPLICAS === "true";
    this.pollInterval = parseInt(
      process.env.REPLICA_LAG_POLL_INTERVAL || "10000",
      10,
    );
    this.warningThreshold = parseInt(
      process.env.REPLICA_LAG_WARNING_THRESHOLD || "5",
      10,
    );
    this.criticalThreshold = parseInt(
      process.env.REPLICA_LAG_CRITICAL_THRESHOLD || "10",
      10,
    );
  }

  async onModuleInit() {
    if (!this.enabled || !this.replicaService.isReplicaEnabled()) {
      this.logger.log("Replica lag monitoring disabled (replicas not enabled)");
      return;
    }

    this.logger.log(
      `Starting replica lag monitoring (poll interval: ${this.pollInterval}ms, ` +
        `warning threshold: ${this.warningThreshold}s, critical threshold: ${this.criticalThreshold}s)`,
    );

    // Initial poll
    await this.pollReplicationLag();

    // Start periodic polling
    this.pollTimer = setInterval(() => {
      this.pollReplicationLag().catch((err) => {
        this.logger.error(`Failed to poll replication lag: ${err.message}`);
      });
    }, this.pollInterval);
  }

  onModuleDestroy() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      this.logger.log("Replica lag monitoring stopped");
    }
  }

  /**
   * Get current replication lag in seconds
   * Returns null if lag is unknown or unavailable
   */
  getCurrentLag(): number | null {
    return this.currentLagSeconds;
  }

  /**
   * Check if replica lag is within acceptable bounds
   * Returns false if lag exceeds warning threshold or is unknown
   */
  isLagAcceptable(): boolean {
    if (this.currentLagSeconds === null) {
      return false; // Unknown lag = not acceptable
    }

    return this.currentLagSeconds <= this.warningThreshold;
  }

  /**
   * Check if replica lag is critical
   */
  isLagCritical(): boolean {
    if (this.currentLagSeconds === null) {
      return true; // Unknown lag = treat as critical for safety
    }

    return this.currentLagSeconds > this.criticalThreshold;
  }

  /**
   * Get lag status summary
   */
  getLagStatus(): {
    lagSeconds: number | null;
    acceptable: boolean;
    critical: boolean;
    lastPoll: Date | null;
    consecutiveFailures: number;
    status: "healthy" | "warning" | "critical" | "unknown";
  } {
    let status: "healthy" | "warning" | "critical" | "unknown";

    if (this.currentLagSeconds === null) {
      status = "unknown";
    } else if (this.isLagCritical()) {
      status = "critical";
    } else if (!this.isLagAcceptable()) {
      status = "warning";
    } else {
      status = "healthy";
    }

    return {
      lagSeconds: this.currentLagSeconds,
      acceptable: this.isLagAcceptable(),
      critical: this.isLagCritical(),
      lastPoll: this.lastSuccessfulPoll,
      consecutiveFailures: this.consecutiveFailures,
      status,
    };
  }

  /**
   * Poll pg_stat_replication to get current lag metrics
   */
  private async pollReplicationLag(): Promise<void> {
    try {
      const primary = this.replicaService.getPrimary();

      // Query pg_stat_replication view on primary
      // This view shows replication status from primary's perspective
      const replicationStats = await primary.$queryRaw<
        Array<{
          application_name: string;
          state: string;
          sync_state: string;
          replay_lag: string | null; // interval type
          write_lag: string | null;
          flush_lag: string | null;
          sent_lsn: string;
          write_lsn: string;
          flush_lsn: string;
          replay_lsn: string;
        }>
      >`
        SELECT 
          application_name,
          state,
          sync_state,
          replay_lag::text,
          write_lag::text,
          flush_lag::text,
          sent_lsn::text,
          write_lsn::text,
          flush_lsn::text,
          replay_lsn::text
        FROM pg_stat_replication
        WHERE state = 'streaming'
        LIMIT 1
      `;

      if (!replicationStats || replicationStats.length === 0) {
        throw new Error("No active replication connections found on primary");
      }

      const stats = replicationStats[0];

      // Parse replay_lag (most important metric - how far behind replica is applying changes)
      const lagSeconds = this.parseLagInterval(stats.replay_lag);

      // Calculate byte lag (difference between sent and replay LSN)
      const byteLag = this.calculateByteLag(stats.sent_lsn, stats.replay_lsn);

      // Update state
      this.currentLagSeconds = lagSeconds;
      this.lastSuccessfulPoll = new Date();
      this.consecutiveFailures = 0;

      // Emit metrics
      try {
        TelemetryMetrics.setReplicaLag(lagSeconds);
        TelemetryMetrics.setReplicaHealth(1); // Healthy

        if (byteLag !== null) {
          TelemetryMetrics.setReplicaLagBytes(byteLag);
        }
      } catch (metricsError) {
        // Non-fatal if metrics fail
        this.logger.debug(`Failed to emit lag metrics: ${metricsError}`);
      }

      // Log warnings based on thresholds
      if (lagSeconds > this.criticalThreshold) {
        this.logger.error(
          `🚨 CRITICAL: Replica lag is ${lagSeconds.toFixed(2)}s ` +
            `(threshold: ${this.criticalThreshold}s) - Consider failover to primary for all reads`,
        );
      } else if (lagSeconds > this.warningThreshold) {
        this.logger.warn(
          `⚠️  WARNING: Replica lag is ${lagSeconds.toFixed(2)}s ` +
            `(threshold: ${this.warningThreshold}s) - Monitor for degradation`,
        );
      } else {
        this.logger.debug(
          `✅ Replica lag: ${lagSeconds.toFixed(2)}s (within acceptable range)`,
        );
      }

      // Log detailed stats in debug mode
      this.logger.debug(
        `Replication stats: state=${stats.state}, sync_state=${stats.sync_state}, ` +
          `write_lag=${stats.write_lag}, flush_lag=${stats.flush_lag}, ` +
          `byte_lag=${byteLag !== null ? byteLag : "N/A"}`,
      );
    } catch (error) {
      this.consecutiveFailures++;
      const err = error as Error;

      this.logger.error(
        `Failed to poll replication lag (${this.consecutiveFailures} consecutive failures): ${err.message}`,
      );

      // Set lag to null (unknown)
      this.currentLagSeconds = null;

      // Emit unhealthy metric
      try {
        TelemetryMetrics.setReplicaHealth(0); // Unhealthy
      } catch {
        // Ignore metrics errors
      }

      // After 3 consecutive failures, log critical warning
      if (this.consecutiveFailures >= 3) {
        this.logger.error(
          `🚨 CRITICAL: Unable to measure replica lag for ${this.consecutiveFailures} consecutive polls ` +
            `- Circuit breaker should fallback to primary`,
        );
      }
    }
  }

  /**
   * Parse PostgreSQL interval string to seconds
   * Examples: "00:00:02.5" -> 2.5, "00:01:30" -> 90
   */
  private parseLagInterval(interval: string | null): number {
    if (!interval) {
      return 0;
    }

    try {
      // Format: HH:MM:SS.microseconds or simpler formats
      const parts = interval.split(":");

      if (parts.length === 3) {
        // HH:MM:SS.microseconds
        const hours = parseInt(parts[0], 10);
        const minutes = parseInt(parts[1], 10);
        const seconds = parseFloat(parts[2]);

        return hours * 3600 + minutes * 60 + seconds;
      } else if (parts.length === 2) {
        // MM:SS
        const minutes = parseInt(parts[0], 10);
        const seconds = parseFloat(parts[1]);

        return minutes * 60 + seconds;
      } else if (parts.length === 1) {
        // Just seconds
        return parseFloat(parts[0]);
      }

      this.logger.warn(`Unexpected lag interval format: ${interval}`);
      return 0;
    } catch (error) {
      this.logger.error(`Failed to parse lag interval "${interval}": ${error}`);
      return 0;
    }
  }

  /**
   * Calculate byte lag between two LSN (Log Sequence Number) positions
   * LSN format: "0/3000000" (segment/offset in hex)
   */
  private calculateByteLag(sentLsn: string, replayLsn: string): number | null {
    try {
      const sent = this.parseLsn(sentLsn);
      const replay = this.parseLsn(replayLsn);

      if (sent === null || replay === null) {
        return null;
      }

      return Math.max(0, sent - replay); // Byte difference
    } catch (error) {
      this.logger.debug(`Failed to calculate byte lag: ${error}`);
      return null;
    }
  }

  /**
   * Parse LSN string to byte offset
   * Format: "segment/offset" in hex (e.g., "0/3000000")
   */
  private parseLsn(lsn: string): number | null {
    try {
      const [segmentHex, offsetHex] = lsn.split("/");
      const segment = parseInt(segmentHex, 16);
      const offset = parseInt(offsetHex, 16);

      // LSN = segment * 16MB + offset
      // (Each WAL segment is 16MB = 16777216 bytes = 0x1000000)
      return segment * 0x1000000 + offset;
    } catch (error) {
      return null;
    }
  }

  /**
   * Force a poll immediately (for testing or manual triggers)
   */
  async forcePoll(): Promise<void> {
    await this.pollReplicationLag();
  }
}
