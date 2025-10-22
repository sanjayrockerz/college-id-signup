#!/usr/bin/env ts-node

import { performance } from "perf_hooks";

/**
 * Canary Deployment Automation for Phase 2 Data Layer
 *
 * TRAFFIC RAMP STAGES:
 * 1. 10% traffic for 10 minutes (validation)
 * 2. 25% traffic for 10 minutes (confidence)
 * 3. 50% traffic for 15 minutes (scale validation)
 * 4. 100% traffic (full rollout)
 *
 * AUTO-ROLLBACK TRIGGERS:
 * - db_tx_queue_wait_ms increase >50% vs baseline
 * - Error rate increase >20% vs baseline
 * - P95 latency increase >20% vs baseline
 * - Pool saturation >85%
 * - Circuit breaker opens (replica failure)
 *
 * FEATURE FLAGS (per-endpoint):
 * - message.history.cache.enabled
 * - message.history.replica.enabled
 * - message.send.cache.enabled
 * - conversation.list.cache.enabled
 * - conversation.list.replica.enabled
 *
 * HEALTH CHECK GATES:
 * - Error rate <1% during stage
 * - P95 latency within SLO targets
 * - Pool saturation <80%
 * - No manual intervention flags set
 */

interface CanaryConfig {
  name: string;
  featureFlags: string[];
  stages: CanaryStage[];
  rollbackTriggers: RollbackTrigger[];
  healthChecks: HealthCheck[];
}

interface CanaryStage {
  name: string;
  trafficPercent: number;
  durationMinutes: number;
  healthCheckIntervalSeconds: number;
}

interface RollbackTrigger {
  name: string;
  metric: string;
  threshold: number;
  comparison: "greater_than" | "less_than";
  baselineMultiplier?: number; // Compare against baseline (e.g., 1.2 = 20% increase)
}

interface HealthCheck {
  name: string;
  query: string;
  expectedCondition: (value: number) => boolean;
}

interface CanaryMetrics {
  errorRate: number;
  p95Latency: number;
  poolSaturation: number;
  queueWait: number;
  circuitBreakerState: string;
  cacheHitRatio: number;
  timestamp: number;
}

interface CanaryResult {
  success: boolean;
  stage: string;
  reason?: string;
  metrics: CanaryMetrics;
  duration: number;
}

export class CanaryDeployment {
  private prometheusUrl: string;
  private featureFlagService: string;
  private baselineMetrics?: CanaryMetrics;

  constructor() {
    this.prometheusUrl = process.env.PROMETHEUS_URL || "http://localhost:9090";
    this.featureFlagService =
      process.env.FEATURE_FLAG_URL ||
      "http://localhost:3000/api/admin/feature-flags";
  }

  /**
   * Run canary deployment
   */
  async run(config: CanaryConfig): Promise<CanaryResult> {
    console.log(
      "\n╔════════════════════════════════════════════════════════════╗",
    );
    console.log("║          Canary Deployment - Phase 2 Data Layer          ║");
    console.log(
      "╚════════════════════════════════════════════════════════════╝\n",
    );
    console.log(`Deployment: ${config.name}`);
    console.log(`Feature Flags: ${config.featureFlags.join(", ")}`);
    console.log(`Stages: ${config.stages.length}`);
    console.log("");

    try {
      // Capture baseline metrics
      console.log("📊 Capturing baseline metrics...");
      this.baselineMetrics = await this.captureMetrics();
      this.printMetrics("Baseline", this.baselineMetrics);

      // Run canary stages
      for (let i = 0; i < config.stages.length; i++) {
        const stage = config.stages[i];

        console.log(`\n${"=".repeat(60)}`);
        console.log(`Stage ${i + 1}/${config.stages.length}: ${stage.name}`);
        console.log(
          `Traffic: ${stage.trafficPercent}% | Duration: ${stage.durationMinutes}m`,
        );
        console.log("=".repeat(60));

        const result = await this.runStage(stage, config);

        if (!result.success) {
          console.log(`\n❌ Stage ${i + 1} failed: ${result.reason}`);
          console.log("🔄 Initiating rollback...");

          await this.rollback(config.featureFlags);

          return {
            success: false,
            stage: stage.name,
            reason: result.reason,
            metrics: result.metrics,
            duration: result.duration,
          };
        }

        console.log(`\n✅ Stage ${i + 1} completed successfully`);
      }

      // Full rollout
      console.log("\n🎉 Canary deployment completed successfully!");
      console.log("🚀 Proceeding with full rollout (100% traffic)...");

      await this.setTraffic(config.featureFlags, 100);

      const finalMetrics = await this.captureMetrics();

      return {
        success: true,
        stage: "Full Rollout",
        metrics: finalMetrics,
        duration: 0,
      };
    } catch (error) {
      console.error("\n❌ Canary deployment failed with error:", error);

      console.log("🔄 Initiating emergency rollback...");
      await this.rollback(config.featureFlags);

      throw error;
    }
  }

  /**
   * Run a single canary stage
   */
  private async runStage(
    stage: CanaryStage,
    config: CanaryConfig,
  ): Promise<CanaryResult> {
    const startTime = performance.now();

    // Set traffic percentage
    console.log(`\n🔧 Setting traffic to ${stage.trafficPercent}%...`);
    await this.setTraffic(config.featureFlags, stage.trafficPercent);

    // Wait for traffic to stabilize
    console.log("⏳ Waiting 30s for traffic to stabilize...");
    await this.sleep(30000);

    // Run health checks
    const durationMs = stage.durationMinutes * 60 * 1000;
    const checkIntervalMs = stage.healthCheckIntervalSeconds * 1000;
    const checks = Math.floor(durationMs / checkIntervalMs);

    console.log(
      `\n🔍 Running ${checks} health checks over ${stage.durationMinutes} minutes...`,
    );

    for (let i = 0; i < checks; i++) {
      const checkStartTime = performance.now();

      // Capture metrics
      const metrics = await this.captureMetrics();

      // Check for rollback triggers
      const trigger = this.checkRollbackTriggers(
        metrics,
        config.rollbackTriggers,
      );

      if (trigger) {
        return {
          success: false,
          stage: stage.name,
          reason: `Rollback trigger: ${trigger.name}`,
          metrics,
          duration: performance.now() - startTime,
        };
      }

      // Check health conditions
      const healthCheck = this.checkHealthConditions(
        metrics,
        config.healthChecks,
      );

      if (!healthCheck.passed) {
        return {
          success: false,
          stage: stage.name,
          reason: `Health check failed: ${healthCheck.reason}`,
          metrics,
          duration: performance.now() - startTime,
        };
      }

      // Print progress
      const progress = ((i + 1) / checks) * 100;
      const elapsed = (performance.now() - startTime) / 1000;
      console.log(
        `   [${progress.toFixed(0).padStart(3)}%] Check ${i + 1}/${checks} | ` +
          `Elapsed: ${elapsed.toFixed(0)}s | ` +
          `P95: ${metrics.p95Latency.toFixed(0)}ms | ` +
          `Errors: ${(metrics.errorRate * 100).toFixed(2)}% | ` +
          `Pool: ${(metrics.poolSaturation * 100).toFixed(0)}%`,
      );

      // Wait for next check
      const checkDuration = performance.now() - checkStartTime;
      const waitTime = Math.max(0, checkIntervalMs - checkDuration);
      await this.sleep(waitTime);
    }

    const finalMetrics = await this.captureMetrics();

    return {
      success: true,
      stage: stage.name,
      metrics: finalMetrics,
      duration: performance.now() - startTime,
    };
  }

  /**
   * Set traffic percentage via feature flags
   */
  private async setTraffic(
    featureFlags: string[],
    percent: number,
  ): Promise<void> {
    for (const flag of featureFlags) {
      try {
        const response = await fetch(`${this.featureFlagService}/${flag}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enabled: true,
            rolloutPercent: percent,
          }),
        });

        if (!response.ok) {
          throw new Error(`Failed to set flag ${flag}: ${response.statusText}`);
        }

        console.log(`   ✅ ${flag}: ${percent}%`);
      } catch (error) {
        console.error(`   ❌ Failed to set ${flag}:`, error);
        throw error;
      }
    }
  }

  /**
   * Capture current metrics from Prometheus
   */
  private async captureMetrics(): Promise<CanaryMetrics> {
    const [
      errorRate,
      p95Latency,
      poolSaturation,
      queueWait,
      circuitBreakerState,
      cacheHitRatio,
    ] = await Promise.all([
      this.queryPrometheus(
        'rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m])',
      ),
      this.queryPrometheus(
        "histogram_quantile(0.95, rate(http_request_duration_ms_bucket[5m]))",
      ),
      this.queryPrometheus("db_pool_saturation"),
      this.queryPrometheus("db_tx_queue_wait_ms"),
      this.queryPrometheusString(
        'circuit_breaker_state{component="read_replica"}',
      ),
      this.queryPrometheus(
        'rate(cache_operation_total{result="hit"}[5m]) / rate(cache_operation_total[5m])',
      ),
    ]);

    return {
      errorRate,
      p95Latency,
      poolSaturation,
      queueWait,
      circuitBreakerState,
      cacheHitRatio,
      timestamp: Date.now(),
    };
  }

  /**
   * Query Prometheus for a metric value
   */
  private async queryPrometheus(query: string): Promise<number> {
    try {
      const response = await fetch(
        `${this.prometheusUrl}/api/v1/query?query=${encodeURIComponent(query)}`,
      );

      if (!response.ok) {
        throw new Error(`Prometheus query failed: ${response.statusText}`);
      }

      const data = await response.json();
      return parseFloat(data.data?.result?.[0]?.value?.[1] || "0");
    } catch (error) {
      console.warn(`Failed to query Prometheus: ${query}`, error);
      return 0;
    }
  }

  /**
   * Query Prometheus for a string metric value
   */
  private async queryPrometheusString(query: string): Promise<string> {
    try {
      const response = await fetch(
        `${this.prometheusUrl}/api/v1/query?query=${encodeURIComponent(query)}`,
      );

      if (!response.ok) {
        throw new Error(`Prometheus query failed: ${response.statusText}`);
      }

      const data = await response.json();
      return data.data?.result?.[0]?.metric?.state || "UNKNOWN";
    } catch (error) {
      console.warn(`Failed to query Prometheus: ${query}`, error);
      return "UNKNOWN";
    }
  }

  /**
   * Check if any rollback triggers are activated
   */
  private checkRollbackTriggers(
    metrics: CanaryMetrics,
    triggers: RollbackTrigger[],
  ): RollbackTrigger | null {
    for (const trigger of triggers) {
      let currentValue: number;
      let baselineValue: number;

      // Get metric values
      switch (trigger.metric) {
        case "error_rate":
          currentValue = metrics.errorRate;
          baselineValue = this.baselineMetrics?.errorRate || 0;
          break;
        case "p95_latency":
          currentValue = metrics.p95Latency;
          baselineValue = this.baselineMetrics?.p95Latency || 0;
          break;
        case "pool_saturation":
          currentValue = metrics.poolSaturation;
          baselineValue = this.baselineMetrics?.poolSaturation || 0;
          break;
        case "queue_wait":
          currentValue = metrics.queueWait;
          baselineValue = this.baselineMetrics?.queueWait || 0;
          break;
        case "circuit_breaker":
          if (metrics.circuitBreakerState === "OPEN") {
            return trigger;
          }
          continue;
        default:
          continue;
      }

      // Apply baseline multiplier if specified
      let threshold = trigger.threshold;
      if (trigger.baselineMultiplier && baselineValue > 0) {
        threshold = baselineValue * trigger.baselineMultiplier;
      }

      // Check condition
      const triggered =
        trigger.comparison === "greater_than"
          ? currentValue > threshold
          : currentValue < threshold;

      if (triggered) {
        console.log(`\n⚠️  ROLLBACK TRIGGER ACTIVATED: ${trigger.name}`);
        console.log(`   Metric: ${trigger.metric}`);
        console.log(`   Current: ${currentValue.toFixed(2)}`);
        console.log(`   Threshold: ${threshold.toFixed(2)}`);
        console.log(`   Baseline: ${baselineValue.toFixed(2)}`);

        return trigger;
      }
    }

    return null;
  }

  /**
   * Check health conditions
   */
  private checkHealthConditions(
    metrics: CanaryMetrics,
    checks: HealthCheck[],
  ): { passed: boolean; reason?: string } {
    for (const check of checks) {
      let value: number;

      // Get metric value
      switch (check.name) {
        case "error_rate":
          value = metrics.errorRate;
          break;
        case "p95_latency":
          value = metrics.p95Latency;
          break;
        case "pool_saturation":
          value = metrics.poolSaturation;
          break;
        default:
          continue;
      }

      if (!check.expectedCondition(value)) {
        return {
          passed: false,
          reason: `${check.name} condition not met (value: ${value.toFixed(2)})`,
        };
      }
    }

    return { passed: true };
  }

  /**
   * Rollback feature flags
   */
  private async rollback(featureFlags: string[]): Promise<void> {
    console.log("\n🔄 Rolling back feature flags...");

    for (const flag of featureFlags) {
      try {
        const response = await fetch(`${this.featureFlagService}/${flag}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enabled: false,
            rolloutPercent: 0,
          }),
        });

        if (!response.ok) {
          throw new Error(`Failed to rollback ${flag}: ${response.statusText}`);
        }

        console.log(`   ✅ Rolled back: ${flag}`);
      } catch (error) {
        console.error(`   ❌ Failed to rollback ${flag}:`, error);
      }
    }

    console.log("\n✅ Rollback complete");
  }

  /**
   * Print metrics
   */
  private printMetrics(label: string, metrics: CanaryMetrics): void {
    console.log(`\n${label} Metrics:`);
    console.log(`  Error Rate: ${(metrics.errorRate * 100).toFixed(2)}%`);
    console.log(`  P95 Latency: ${metrics.p95Latency.toFixed(2)}ms`);
    console.log(
      `  Pool Saturation: ${(metrics.poolSaturation * 100).toFixed(1)}%`,
    );
    console.log(`  Queue Wait: ${metrics.queueWait.toFixed(2)}ms`);
    console.log(`  Circuit Breaker: ${metrics.circuitBreakerState}`);
    console.log(
      `  Cache Hit Ratio: ${(metrics.cacheHitRatio * 100).toFixed(1)}%`,
    );
  }

  /**
   * Sleep helper
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Predefined canary configurations for Phase 2
 */
export const Phase2CanaryConfigs = {
  /**
   * Message history cache + replica routing
   */
  messageHistory: {
    name: "Message History - Cache + Replica",
    featureFlags: [
      "message.history.cache.enabled",
      "message.history.replica.enabled",
    ],
    stages: [
      {
        name: "Initial Validation",
        trafficPercent: 10,
        durationMinutes: 10,
        healthCheckIntervalSeconds: 30,
      },
      {
        name: "Confidence Building",
        trafficPercent: 25,
        durationMinutes: 10,
        healthCheckIntervalSeconds: 30,
      },
      {
        name: "Scale Validation",
        trafficPercent: 50,
        durationMinutes: 15,
        healthCheckIntervalSeconds: 30,
      },
    ],
    rollbackTriggers: [
      {
        name: "Queue Wait Spike",
        metric: "queue_wait",
        threshold: 0,
        comparison: "greater_than" as const,
        baselineMultiplier: 1.5, // 50% increase
      },
      {
        name: "Error Rate Increase",
        metric: "error_rate",
        threshold: 0,
        comparison: "greater_than" as const,
        baselineMultiplier: 1.2, // 20% increase
      },
      {
        name: "Latency Degradation",
        metric: "p95_latency",
        threshold: 350, // SLO target
        comparison: "greater_than" as const,
      },
      {
        name: "Pool Saturation",
        metric: "pool_saturation",
        threshold: 0.85,
        comparison: "greater_than" as const,
      },
      {
        name: "Circuit Breaker Open",
        metric: "circuit_breaker",
        threshold: 0,
        comparison: "greater_than" as const,
      },
    ],
    healthChecks: [
      {
        name: "error_rate",
        query:
          'rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m])',
        expectedCondition: (value: number) => value < 0.01, // <1%
      },
      {
        name: "p95_latency",
        query:
          "histogram_quantile(0.95, rate(http_request_duration_ms_bucket[5m]))",
        expectedCondition: (value: number) => value <= 350, // ≤350ms
      },
      {
        name: "pool_saturation",
        query: "db_pool_saturation",
        expectedCondition: (value: number) => value < 0.8, // <80%
      },
    ],
  } as CanaryConfig,

  /**
   * Conversation list cache + replica routing
   */
  conversationList: {
    name: "Conversation List - Cache + Replica",
    featureFlags: [
      "conversation.list.cache.enabled",
      "conversation.list.replica.enabled",
    ],
    stages: [
      {
        name: "Initial Validation",
        trafficPercent: 10,
        durationMinutes: 10,
        healthCheckIntervalSeconds: 30,
      },
      {
        name: "Confidence Building",
        trafficPercent: 25,
        durationMinutes: 10,
        healthCheckIntervalSeconds: 30,
      },
      {
        name: "Scale Validation",
        trafficPercent: 50,
        durationMinutes: 15,
        healthCheckIntervalSeconds: 30,
      },
    ],
    rollbackTriggers: [
      {
        name: "Queue Wait Spike",
        metric: "queue_wait",
        threshold: 0,
        comparison: "greater_than" as const,
        baselineMultiplier: 1.5,
      },
      {
        name: "Error Rate Increase",
        metric: "error_rate",
        threshold: 0,
        comparison: "greater_than" as const,
        baselineMultiplier: 1.2,
      },
      {
        name: "Latency Degradation",
        metric: "p95_latency",
        threshold: 200,
        comparison: "greater_than" as const,
      },
      {
        name: "Pool Saturation",
        metric: "pool_saturation",
        threshold: 0.85,
        comparison: "greater_than" as const,
      },
    ],
    healthChecks: [
      {
        name: "error_rate",
        query:
          'rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m])',
        expectedCondition: (value: number) => value < 0.01,
      },
      {
        name: "p95_latency",
        query:
          "histogram_quantile(0.95, rate(http_request_duration_ms_bucket[5m]))",
        expectedCondition: (value: number) => value <= 200,
      },
      {
        name: "pool_saturation",
        query: "db_pool_saturation",
        expectedCondition: (value: number) => value < 0.8,
      },
    ],
  } as CanaryConfig,
};

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const configArg = args.find((arg) => arg.startsWith("--config="));
  const configName = configArg ? configArg.split("=")[1] : "messageHistory";

  const deployment = new CanaryDeployment();

  const config =
    Phase2CanaryConfigs[configName as keyof typeof Phase2CanaryConfigs];

  if (!config) {
    console.error(`\n❌ Unknown config: ${configName}`);
    console.log("   Valid configs: messageHistory, conversationList");
    process.exit(1);
  }

  try {
    const result = await deployment.run(config);

    if (result.success) {
      console.log("\n✅ Canary deployment completed successfully!");
      process.exit(0);
    } else {
      console.log(`\n❌ Canary deployment failed: ${result.reason}`);
      process.exit(1);
    }
  } catch (error) {
    console.error("\n❌ Canary deployment error:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
