#!/usr/bin/env ts-node
/**
 * Generator Calibration Tool
 *
 * Fits parametric models (log-normal, power-law) to production shape metrics
 * and generates calibrated synthetic data configuration.
 *
 * Usage:
 *   ts-node calibrate-generator.ts --shape shape-metrics-prod.json --output calibrated-config.json
 */

import * as fs from "fs";

interface ShapeMetrics {
  extracted_at: string;
  sample_window_days: number;
  users: {
    total_count: number;
    username_length_histogram: Record<string, number>;
  };
  conversations: {
    total_count: number;
    type_distribution: Record<string, number>;
    messages_per_conversation_percentiles: {
      p50: number;
      p75: number;
      p90: number;
      p95: number;
      p99: number;
      max: number;
    };
  };
  messages: {
    total_count: number;
    content_length_histogram: Record<string, number>;
    content_length_stats: {
      mean: number;
      median: number;
      p95: number;
    };
    type_distribution: Record<string, number>;
    hourly_distribution: number[];
    day_of_week_distribution: number[];
  };
}

interface CalibratedConfig {
  calibration_metadata: {
    source_shape_file: string;
    calibrated_at: string;
    production_sample_window_days: number;
  };

  user_generation: {
    username_length: {
      distribution: "normal";
      mean: number;
      stddev: number;
    };
  };

  conversation_generation: {
    type_distribution: {
      DIRECT_MESSAGE: number;
      GROUP_CHAT: number;
      CHANNEL: number;
    };
    messages_per_conversation: {
      distribution: "power_law";
      alpha: number;
      min: number;
      max: number;
      p50: number;
      p90: number;
      p99: number;
    };
  };

  message_generation: {
    content_length: {
      distribution: "log_normal";
      mean: number;
      median: number;
      p95: number;
    };
    type_distribution: Record<string, number>;
    temporal: {
      hourly_weights: number[];
      day_of_week_weights: number[];
    };
  };
}

class GeneratorCalibrator {
  private metrics: ShapeMetrics;

  constructor(metricsPath: string) {
    console.log(`[Calibrator] Loading shape metrics from ${metricsPath}...`);
    const raw = fs.readFileSync(metricsPath, "utf-8");
    this.metrics = JSON.parse(raw);
    console.log(
      `[Calibrator] ✓ Loaded metrics from ${this.metrics.extracted_at}`,
    );
    console.log(
      `[Calibrator]   Users: ${this.metrics.users.total_count.toLocaleString()}`,
    );
    console.log(
      `[Calibrator]   Conversations: ${this.metrics.conversations.total_count.toLocaleString()}`,
    );
    console.log(
      `[Calibrator]   Messages: ${this.metrics.messages.total_count.toLocaleString()}\n`,
    );
  }

  /**
   * Estimate normal distribution parameters from histogram
   */
  private fitNormalFromHistogram(histogram: Record<string, number>): {
    mean: number;
    stddev: number;
  } {
    let totalCount = 0;
    let weightedSum = 0;

    // Calculate mean from histogram buckets
    for (const [bucket, count] of Object.entries(histogram)) {
      const [minStr] = bucket.split("-");
      const bucketMidpoint = parseInt(minStr) + 2.5; // Assume bucket size 5
      weightedSum += bucketMidpoint * count;
      totalCount += count;
    }

    const mean = weightedSum / totalCount;

    // Calculate standard deviation
    let varianceSum = 0;
    for (const [bucket, count] of Object.entries(histogram)) {
      const [minStr] = bucket.split("-");
      const bucketMidpoint = parseInt(minStr) + 2.5;
      varianceSum += Math.pow(bucketMidpoint - mean, 2) * count;
    }

    const stddev = Math.sqrt(varianceSum / totalCount);

    return { mean, stddev };
  }

  /**
   * Estimate power-law alpha from percentiles using method of moments
   */
  private fitPowerLawFromPercentiles(percentiles: {
    p50: number;
    p90: number;
    p99: number;
    max: number;
  }): { alpha: number; min: number; max: number } {
    // Power law: P(X > x) = (x/xmin)^(-alpha)
    // For alpha estimation, use ratio of percentiles

    const p50 = percentiles.p50;
    const p90 = percentiles.p90;
    const p99 = percentiles.p99;

    // Estimate alpha from p50/p90 ratio
    // P(X > p50) = 0.5, P(X > p90) = 0.1
    // (p90/p50)^alpha = 5
    // alpha = ln(5) / ln(p90/p50)

    let alpha = 1.5; // default
    if (p90 > p50 && p50 > 0) {
      alpha = Math.log(5) / Math.log(p90 / p50);
      // Clamp to reasonable range
      alpha = Math.max(1.1, Math.min(3.0, alpha));
    }

    return {
      alpha: Math.round(alpha * 100) / 100,
      min: 1,
      max: percentiles.max,
    };
  }

  /**
   * Normalize distribution to percentages
   */
  private normalizeDistribution(
    dist: Record<string, number>,
  ): Record<string, number> {
    const total = Object.values(dist).reduce((sum, v) => sum + v, 0);
    const normalized: Record<string, number> = {};

    for (const [key, value] of Object.entries(dist)) {
      normalized[key] = Math.round((value / total) * 10000) / 10000;
    }

    return normalized;
  }

  /**
   * Normalize array to weights summing to 1.0
   */
  private normalizeWeights(weights: number[]): number[] {
    const total = weights.reduce((sum, v) => sum + v, 0);
    return weights.map((w) => Math.round((w / total) * 10000) / 10000);
  }

  /**
   * Generate calibrated configuration
   */
  calibrate(): CalibratedConfig {
    console.log("[Calibrator] Fitting parametric models...\n");

    // 1. Username length distribution
    console.log(
      "[Calibrator] Fitting username length (normal distribution)...",
    );
    const usernameParams = this.fitNormalFromHistogram(
      this.metrics.users.username_length_histogram,
    );
    console.log(
      `[Calibrator]   Mean: ${usernameParams.mean.toFixed(2)}, StdDev: ${usernameParams.stddev.toFixed(2)}`,
    );

    // 2. Conversation type distribution
    console.log("\n[Calibrator] Normalizing conversation type distribution...");
    const convoTypesDist = this.normalizeDistribution(
      this.metrics.conversations.type_distribution,
    );
    console.log(
      `[Calibrator]   DIRECT_MESSAGE: ${(convoTypesDist.DIRECT_MESSAGE * 100).toFixed(1)}%`,
    );
    console.log(
      `[Calibrator]   GROUP_CHAT: ${(convoTypesDist.GROUP_CHAT * 100).toFixed(1)}%`,
    );
    console.log(
      `[Calibrator]   CHANNEL: ${((convoTypesDist.CHANNEL || 0) * 100).toFixed(1)}%`,
    );

    // 3. Messages per conversation (power law)
    console.log(
      "\n[Calibrator] Fitting messages per conversation (power law)...",
    );
    const msgPerConvoParams = this.fitPowerLawFromPercentiles(
      this.metrics.conversations.messages_per_conversation_percentiles,
    );
    console.log(`[Calibrator]   Alpha: ${msgPerConvoParams.alpha}`);
    console.log(
      `[Calibrator]   Range: [${msgPerConvoParams.min}, ${msgPerConvoParams.max}]`,
    );
    console.log(
      `[Calibrator]   Production p50: ${this.metrics.conversations.messages_per_conversation_percentiles.p50}`,
    );
    console.log(
      `[Calibrator]   Production p99: ${this.metrics.conversations.messages_per_conversation_percentiles.p99}`,
    );

    // 4. Message type distribution
    console.log("\n[Calibrator] Normalizing message type distribution...");
    const msgTypesDist = this.normalizeDistribution(
      this.metrics.messages.type_distribution,
    );
    for (const [type, prob] of Object.entries(msgTypesDist)) {
      console.log(`[Calibrator]   ${type}: ${(prob * 100).toFixed(1)}%`);
    }

    // 5. Temporal distributions
    console.log("\n[Calibrator] Normalizing temporal distributions...");
    const hourlyWeights = this.normalizeWeights(
      this.metrics.messages.hourly_distribution,
    );
    const dowWeights = this.normalizeWeights(
      this.metrics.messages.day_of_week_distribution,
    );

    const peakHour = hourlyWeights.indexOf(Math.max(...hourlyWeights));
    const peakDay = dowWeights.indexOf(Math.max(...dowWeights));
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    console.log(
      `[Calibrator]   Peak hour: ${peakHour}:00 (${(hourlyWeights[peakHour] * 100).toFixed(1)}%)`,
    );
    console.log(
      `[Calibrator]   Peak day: ${dayNames[peakDay]} (${(dowWeights[peakDay] * 100).toFixed(1)}%)`,
    );

    // Build calibrated config
    const config: CalibratedConfig = {
      calibration_metadata: {
        source_shape_file: this.metrics.extracted_at,
        calibrated_at: new Date().toISOString(),
        production_sample_window_days: this.metrics.sample_window_days,
      },
      user_generation: {
        username_length: {
          distribution: "normal",
          mean: Math.round(usernameParams.mean * 10) / 10,
          stddev: Math.round(usernameParams.stddev * 10) / 10,
        },
      },
      conversation_generation: {
        type_distribution: {
          DIRECT_MESSAGE: convoTypesDist.DIRECT_MESSAGE || 0.7,
          GROUP_CHAT: convoTypesDist.GROUP_CHAT || 0.3,
          CHANNEL: convoTypesDist.CHANNEL || 0.0,
        },
        messages_per_conversation: {
          distribution: "power_law",
          alpha: msgPerConvoParams.alpha,
          min: msgPerConvoParams.min,
          max: msgPerConvoParams.max,
          p50: this.metrics.conversations.messages_per_conversation_percentiles
            .p50,
          p90: this.metrics.conversations.messages_per_conversation_percentiles
            .p90,
          p99: this.metrics.conversations.messages_per_conversation_percentiles
            .p99,
        },
      },
      message_generation: {
        content_length: {
          distribution: "log_normal",
          mean: this.metrics.messages.content_length_stats.mean,
          median: this.metrics.messages.content_length_stats.median,
          p95: this.metrics.messages.content_length_stats.p95,
        },
        type_distribution: msgTypesDist,
        temporal: {
          hourly_weights: hourlyWeights,
          day_of_week_weights: dowWeights,
        },
      },
    };

    console.log("\n[Calibrator] ✓ Calibration complete");
    return config;
  }
}

// CLI
async function main() {
  const args = process.argv.slice(2);

  let shapePath = "";
  let outputPath = "calibrated-config.json";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--shape" && args[i + 1]) {
      shapePath = args[i + 1];
      i++;
    } else if (args[i] === "--output" && args[i + 1]) {
      outputPath = args[i + 1];
      i++;
    } else if (args[i] === "--help") {
      console.log(`
Usage: ts-node calibrate-generator.ts [options]

Options:
  --shape <path>    Path to shape metrics JSON (required)
  --output <path>   Output calibrated config path (default: calibrated-config.json)
  --help            Show this help

Example:
  ts-node calibrate-generator.ts --shape shape-metrics-prod.json --output config-prod-calibrated.json
      `);
      process.exit(0);
    }
  }

  if (!shapePath) {
    console.error("ERROR: --shape argument is required");
    console.error("Run with --help for usage information");
    process.exit(1);
  }

  if (!fs.existsSync(shapePath)) {
    console.error(`ERROR: Shape metrics file not found: ${shapePath}`);
    process.exit(1);
  }

  console.log("\n=== GENERATOR CALIBRATION ===\n");

  const calibrator = new GeneratorCalibrator(shapePath);
  const config = calibrator.calibrate();

  fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));
  console.log(`\n[Output] ✓ Written to ${outputPath}`);
  console.log("\n=== CALIBRATION COMPLETE ===");
  console.log("\nNext steps:");
  console.log(`  1. Review calibrated parameters in ${outputPath}`);
  console.log("  2. Update generator.ts to use calibrated distributions");
  console.log("  3. Generate pilot dataset (5-10M messages)");
  console.log("  4. Run fidelity validation");
}

main().catch((err) => {
  console.error("\n[FATAL ERROR]", err.message);
  process.exit(1);
});
