import { Injectable, Logger } from "@nestjs/common";
import { ReplicaLagMonitor } from "./replica-lag-monitor.service";
import { PrismaReadReplicaService } from "./prisma-read-replica.service";
import { TelemetryMetrics } from "../../observability/metrics-registry";

/**
 * ReadReplicaCircuitBreaker
 *
 * Implements circuit breaker pattern for read replica routing.
 * Automatically falls back to primary when:
 * - Replica lag exceeds acceptable threshold
 * - Replica connection is unhealthy
 * - Lag metrics are unavailable
 *
 * States:
 * - CLOSED: Replica routing allowed (normal operation)
 * - OPEN: Replica routing blocked, all reads to primary (failover)
 * - HALF_OPEN: Testing if replica has recovered
 *
 * Emits read_routing_total metrics with target: primary/replica/fallback
 */
@Injectable()
export class ReadReplicaCircuitBreaker {
  private readonly logger = new Logger(ReadReplicaCircuitBreaker.name);

  private state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";
  private lastStateChange: Date = new Date();
  private failureCount = 0;
  private successCount = 0;

  // Circuit breaker thresholds
  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly openStateDuration: number; // ms before attempting HALF_OPEN
  private readonly halfOpenTimeout: number; // ms before closing circuit if successful

  constructor(
    private readonly lagMonitor: ReplicaLagMonitor,
    private readonly replicaService: PrismaReadReplicaService,
  ) {
    // Configuration from environment
    this.failureThreshold = parseInt(
      process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD || "3",
      10,
    );
    this.successThreshold = parseInt(
      process.env.CIRCUIT_BREAKER_SUCCESS_THRESHOLD || "5",
      10,
    );
    this.openStateDuration = parseInt(
      process.env.CIRCUIT_BREAKER_OPEN_DURATION || "30000",
      10,
    ); // 30s
    this.halfOpenTimeout = parseInt(
      process.env.CIRCUIT_BREAKER_HALF_OPEN_TIMEOUT || "10000",
      10,
    ); // 10s
  }

  /**
   * Check if reads can be routed to replica
   * @param endpointName Endpoint name for logging and metrics
   * @returns true if replica is safe to use, false if should fallback to primary
   */
  canRouteToReplica(endpointName: string): boolean {
    // If replicas not enabled, always use primary
    if (!this.replicaService.isReplicaEnabled()) {
      this.recordRouting("primary", endpointName);
      return false;
    }

    // Check endpoint-specific flag
    if (!this.replicaService.isReplicaEnabledForEndpoint(endpointName)) {
      this.recordRouting("primary", endpointName);
      return false;
    }

    // State machine logic
    switch (this.state) {
      case "CLOSED":
        // Normal operation - check lag and health
        return this.checkReplicaHealth(endpointName);

      case "OPEN": {
        // Circuit is open - check if we should attempt recovery
        const timeSinceOpen = Date.now() - this.lastStateChange.getTime();

        if (timeSinceOpen >= this.openStateDuration) {
          this.transitionToHalfOpen();
          return this.checkReplicaHealth(endpointName);
        }

        // Still in open state - use primary
        this.recordRouting("fallback", endpointName);
        return false;
      }

      case "HALF_OPEN":
        // Testing recovery - allow limited traffic
        return this.checkReplicaHealth(endpointName);

      default:
        // Unknown state - fail safe to primary
        this.logger.error(`Unknown circuit breaker state: ${this.state}`);
        this.recordRouting("fallback", endpointName);
        return false;
    }
  }

  /**
   * Record successful replica read
   * Used to close circuit after recovery
   */
  recordSuccess(): void {
    if (this.state === "HALF_OPEN") {
      this.successCount++;

      if (this.successCount >= this.successThreshold) {
        this.transitionToClosed();
      }
    } else if (this.state === "CLOSED") {
      // Reset failure count on success
      this.failureCount = 0;
    }
  }

  /**
   * Record failed replica read
   * Used to open circuit when failures accumulate
   */
  recordFailure(): void {
    if (this.state === "HALF_OPEN") {
      // Any failure in HALF_OPEN immediately reopens circuit
      this.transitionToOpen();
    } else if (this.state === "CLOSED") {
      this.failureCount++;

      if (this.failureCount >= this.failureThreshold) {
        this.transitionToOpen();
      }
    }
  }

  /**
   * Get current circuit breaker status
   */
  getStatus(): {
    state: "CLOSED" | "OPEN" | "HALF_OPEN";
    failureCount: number;
    successCount: number;
    lastStateChange: Date;
    replicaAvailable: boolean;
    lagStatus: any;
  } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastStateChange: this.lastStateChange,
      replicaAvailable: this.state === "CLOSED" || this.state === "HALF_OPEN",
      lagStatus: this.lagMonitor.getLagStatus(),
    };
  }

  /**
   * Manually open circuit (emergency fallback to primary)
   */
  forceOpen(): void {
    this.logger.warn(
      "🚨 Circuit breaker manually opened - all reads to primary",
    );
    this.transitionToOpen();
  }

  /**
   * Manually close circuit (re-enable replica routing)
   */
  forceClosed(): void {
    this.logger.log(
      "✅ Circuit breaker manually closed - replica routing enabled",
    );
    this.transitionToClosed();
  }

  /**
   * Check replica health and lag
   */
  private checkReplicaHealth(endpointName: string): boolean {
    // Check lag status
    const lagStatus = this.lagMonitor.getLagStatus();

    // If lag is unknown or critical, fail to primary
    if (lagStatus.status === "unknown" || lagStatus.status === "critical") {
      this.logger.warn(
        `Replica routing blocked for ${endpointName}: lag status=${lagStatus.status}, ` +
          `lag=${lagStatus.lagSeconds !== null ? lagStatus.lagSeconds.toFixed(2) + "s" : "unknown"}`,
      );

      this.recordFailure();
      this.recordRouting("fallback", endpointName);
      return false;
    }

    // If lag is acceptable, allow replica routing
    if (lagStatus.acceptable) {
      this.recordSuccess();
      this.recordRouting("replica", endpointName);
      return true;
    }

    // Lag is in warning range but not critical
    this.logger.debug(
      `Replica routing allowed with warning for ${endpointName}: lag=${lagStatus.lagSeconds}s`,
    );
    this.recordRouting("replica", endpointName);
    return true;
  }

  /**
   * Transition to OPEN state (circuit tripped)
   */
  private transitionToOpen(): void {
    if (this.state === "OPEN") {
      return; // Already open
    }

    this.state = "OPEN";
    this.lastStateChange = new Date();
    this.failureCount = 0;
    this.successCount = 0;

    this.logger.error(
      `🚨 Circuit breaker OPENED - All reads routed to primary for ${this.openStateDuration}ms`,
    );
  }

  /**
   * Transition to HALF_OPEN state (testing recovery)
   */
  private transitionToHalfOpen(): void {
    if (this.state === "HALF_OPEN") {
      return; // Already half-open
    }

    this.state = "HALF_OPEN";
    this.lastStateChange = new Date();
    this.successCount = 0;
    this.failureCount = 0;

    this.logger.log(
      `🔄 Circuit breaker HALF_OPEN - Testing replica recovery ` +
        `(need ${this.successThreshold} consecutive successes)`,
    );
  }

  /**
   * Transition to CLOSED state (normal operation)
   */
  private transitionToClosed(): void {
    if (this.state === "CLOSED") {
      return; // Already closed
    }

    this.state = "CLOSED";
    this.lastStateChange = new Date();
    this.failureCount = 0;
    this.successCount = 0;

    this.logger.log(
      `✅ Circuit breaker CLOSED - Replica routing fully restored`,
    );
  }

  /**
   * Record routing decision in metrics
   */
  private recordRouting(
    target: "primary" | "replica" | "fallback",
    endpoint: string,
  ): void {
    try {
      TelemetryMetrics.incrementReadRouting(target, endpoint);
    } catch (error) {
      // Don't let metrics failures affect routing
      this.logger.debug(`Failed to record routing metric: ${error}`);
    }
  }
}
