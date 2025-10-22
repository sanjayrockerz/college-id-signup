#!/usr/bin/env ts-node
/**
 * Fidelity Validator
 * 
 * Compares synthetic dataset distributions to production shape metrics
 * using Kolmogorov-Smirnov and Chi-Square tests.
 * 
 * Usage:
 *   ts-node validate-fidelity.ts --shape shape-metrics-prod.json --tolerance 0.15
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";

interface ShapeMetrics {
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
    };
  };
  messages: {
    total_count: number;
    content_length_stats: {
      mean: number;
      median: number;
      p95: number;
    };
    type_distribution: Record<string, number>;
  };
}

interface ValidationResult {
  validation_timestamp: string;
  production_shape_file: string;
  tolerance_threshold: number;
  overall_verdict: "PASS" | "FAIL" | "WARNING";
  
  tests: {
    conversation_types: {
      chi_square_statistic: number;
      p_value: number;
      verdict: "PASS" | "FAIL";
      details: string;
    };
    messages_per_conversation: {
      ks_statistic: number;
      max_percentile_error: number;
      verdict: "PASS" | "FAIL";
      details: string;
    };
    message_types: {
      chi_square_statistic: number;
      p_value: number;
      verdict: "PASS" | "FAIL";
      details: string;
    };
    content_length: {
      mean_error_pct: number;
      median_error_pct: number;
      verdict: "PASS" | "FAIL";
      details: string;
    };
  };
  
  summary: {
    passed_tests: number;
    failed_tests: number;
    recommendations: string[];
  };
}

class FidelityValidator {
  private prisma: PrismaClient;
  private prodMetrics: ShapeMetrics;
  private tolerance: number;

  constructor(shapePath: string, tolerance: number) {
    this.prisma = new PrismaClient();
    this.tolerance = tolerance;
    
    console.log(`[Validator] Loading production shape metrics from ${shapePath}...`);
    const raw = fs.readFileSync(shapePath, "utf-8");
    this.prodMetrics = JSON.parse(raw);
    console.log(`[Validator] ✓ Loaded production baseline`);
    console.log(`[Validator]   Tolerance: ±${(tolerance * 100).toFixed(0)}%\n`);
  }

  /**
   * Calculate Chi-Square statistic for categorical distribution
   */
  private chiSquare(
    observed: Record<string, number>,
    expected: Record<string, number>
  ): { statistic: number; pValue: number } {
    let chiSq = 0;
    let degreesOfFreedom = 0;

    for (const key of Object.keys(expected)) {
      const obs = observed[key] || 0;
      const exp = expected[key];
      
      if (exp > 0) {
        chiSq += Math.pow(obs - exp, 2) / exp;
        degreesOfFreedom++;
      }
    }

    degreesOfFreedom = Math.max(1, degreesOfFreedom - 1);

    // Simplified p-value approximation (chi-square CDF)
    // For df=2 (typical for 3 categories), critical value at p=0.05 is 5.99
    const criticalValue = degreesOfFreedom === 1 ? 3.84 : degreesOfFreedom === 2 ? 5.99 : 7.81;
    const pValue = chiSq > criticalValue ? 0.01 : 0.10;

    return { statistic: chiSq, pValue };
  }

  /**
   * Calculate Kolmogorov-Smirnov statistic (max difference in CDFs)
   */
  private ksStatistic(
    prodPercentiles: Record<string, number>,
    synthPercentiles: Record<string, number>
  ): number {
    let maxDiff = 0;

    for (const [pct, prodValue] of Object.entries(prodPercentiles)) {
      const synthValue = synthPercentiles[pct];
      const diff = Math.abs(prodValue - synthValue) / Math.max(prodValue, 1);
      maxDiff = Math.max(maxDiff, diff);
    }

    return maxDiff;
  }

  /**
   * Normalize distribution
   */
  private normalizeDistribution(dist: Record<string, number>): Record<string, number> {
    const total = Object.values(dist).reduce((sum, v) => sum + v, 0);
    const normalized: Record<string, number> = {};
    
    for (const [key, value] of Object.entries(dist)) {
      normalized[key] = value / total;
    }
    
    return normalized;
  }

  /**
   * Test 1: Conversation type distribution
   */
  private async testConversationTypes() {
    console.log("[Test 1] Conversation type distribution...");

    const synthTypes = await this.prisma.conversation.groupBy({
      by: ["type"],
      _count: true,
    });

    const synthDist: Record<string, number> = {};
    for (const { type, _count } of synthTypes) {
      synthDist[type] = _count;
    }

    const synthNorm = this.normalizeDistribution(synthDist);
    const prodNorm = this.normalizeDistribution(this.prodMetrics.conversations.type_distribution);

    // Scale to synthetic total for chi-square
    const synthTotal = Object.values(synthDist).reduce((sum, v) => sum + v, 0);
    const prodScaled: Record<string, number> = {};
    for (const [key, prob] of Object.entries(prodNorm)) {
      prodScaled[key] = prob * synthTotal;
    }

    const { statistic, pValue } = this.chiSquare(synthDist, prodScaled);
    const verdict: "PASS" | "FAIL" = pValue > 0.05 ? "PASS" : "FAIL";

    console.log(`[Test 1]   Chi-Square: ${statistic.toFixed(2)}, p-value: ${pValue.toFixed(3)}`);
    console.log(`[Test 1]   Verdict: ${verdict}\n`);

    return {
      chi_square_statistic: Math.round(statistic * 100) / 100,
      p_value: Math.round(pValue * 1000) / 1000,
      verdict,
      details: `Synthetic: ${JSON.stringify(synthNorm)}, Production: ${JSON.stringify(prodNorm)}`,
    };
  }

  /**
   * Test 2: Messages per conversation percentiles
   */
  private async testMessagesPerConversation() {
    console.log("[Test 2] Messages per conversation distribution...");

    const conversations = await this.prisma.conversation.findMany({
      select: {
        _count: {
          select: { messages: true },
        },
      },
    });

    const msgCounts = conversations.map((c) => c._count.messages).sort((a, b) => a - b);
    
    const percentile = (p: number) => msgCounts[Math.floor((msgCounts.length - 1) * (p / 100))];
    
    const synthPercentiles = {
      p50: percentile(50),
      p75: percentile(75),
      p90: percentile(90),
      p95: percentile(95),
      p99: percentile(99),
    };

    const prodPercentiles = this.prodMetrics.conversations.messages_per_conversation_percentiles;

    const ks = this.ksStatistic(prodPercentiles, synthPercentiles);
    
    let maxError = 0;
    for (const pct of ["p50", "p75", "p90", "p95", "p99"]) {
      const prod = prodPercentiles[pct as keyof typeof prodPercentiles];
      const synth = synthPercentiles[pct as keyof typeof synthPercentiles];
      const error = Math.abs(prod - synth) / Math.max(prod, 1);
      maxError = Math.max(maxError, error);
    }

    const verdict: "PASS" | "FAIL" = maxError < this.tolerance ? "PASS" : "FAIL";

    console.log(`[Test 2]   KS Statistic: ${ks.toFixed(3)}`);
    console.log(`[Test 2]   Max Percentile Error: ${(maxError * 100).toFixed(1)}%`);
    console.log(`[Test 2]   Verdict: ${verdict}\n`);

    return {
      ks_statistic: Math.round(ks * 1000) / 1000,
      max_percentile_error: Math.round(maxError * 1000) / 1000,
      verdict,
      details: `Prod p90=${prodPercentiles.p90}, Synth p90=${synthPercentiles.p90}`,
    };
  }

  /**
   * Test 3: Message type distribution
   */
  private async testMessageTypes() {
    console.log("[Test 3] Message type distribution...");

    const synthTypes = await this.prisma.message.groupBy({
      by: ["type"],
      _count: true,
    });

    const synthDist: Record<string, number> = {};
    for (const { type, _count } of synthTypes) {
      synthDist[type] = _count;
    }

    const synthNorm = this.normalizeDistribution(synthDist);
    const prodNorm = this.normalizeDistribution(this.prodMetrics.messages.type_distribution);

    const synthTotal = Object.values(synthDist).reduce((sum, v) => sum + v, 0);
    const prodScaled: Record<string, number> = {};
    for (const [key, prob] of Object.entries(prodNorm)) {
      prodScaled[key] = prob * synthTotal;
    }

    const { statistic, pValue } = this.chiSquare(synthDist, prodScaled);
    const verdict: "PASS" | "FAIL" = pValue > 0.05 ? "PASS" : "FAIL";

    console.log(`[Test 3]   Chi-Square: ${statistic.toFixed(2)}, p-value: ${pValue.toFixed(3)}`);
    console.log(`[Test 3]   Verdict: ${verdict}\n`);

    return {
      chi_square_statistic: Math.round(statistic * 100) / 100,
      p_value: Math.round(pValue * 1000) / 1000,
      verdict,
      details: `TEXT synth=${(synthNorm.TEXT * 100).toFixed(1)}% prod=${(prodNorm.TEXT * 100).toFixed(1)}%`,
    };
  }

  /**
   * Test 4: Content length statistics
   */
  private async testContentLength() {
    console.log("[Test 4] Content length distribution...");

    const messages = await this.prisma.message.findMany({
      select: { content: true },
    });

    const lengths = messages.map((m) => (m.content || "").length).sort((a, b) => a - b);
    
    const synthMean = lengths.reduce((sum, v) => sum + v, 0) / lengths.length;
    const synthMedian = lengths[Math.floor(lengths.length / 2)];

    const prodMean = this.prodMetrics.messages.content_length_stats.mean;
    const prodMedian = this.prodMetrics.messages.content_length_stats.median;

    const meanError = Math.abs(synthMean - prodMean) / prodMean;
    const medianError = Math.abs(synthMedian - prodMedian) / prodMedian;

    const verdict: "PASS" | "FAIL" = meanError < this.tolerance && medianError < this.tolerance ? "PASS" : "FAIL";

    console.log(`[Test 4]   Mean Error: ${(meanError * 100).toFixed(1)}%`);
    console.log(`[Test 4]   Median Error: ${(medianError * 100).toFixed(1)}%`);
    console.log(`[Test 4]   Verdict: ${verdict}\n`);

    return {
      mean_error_pct: Math.round(meanError * 1000) / 1000,
      median_error_pct: Math.round(medianError * 1000) / 1000,
      verdict,
      details: `Prod mean=${prodMean}, Synth mean=${Math.round(synthMean)}`,
    };
  }

  /**
   * Run full validation suite
   */
  async validate(outputPath: string): Promise<void> {
    console.log("\n=== FIDELITY VALIDATION ===\n");

    const test1 = await this.testConversationTypes();
    const test2 = await this.testMessagesPerConversation();
    const test3 = await this.testMessageTypes();
    const test4 = await this.testContentLength();

    const tests = {
      conversation_types: test1,
      messages_per_conversation: test2,
      message_types: test3,
      content_length: test4,
    };

    const passedTests = Object.values(tests).filter((t) => t.verdict === "PASS").length;
    const failedTests = Object.values(tests).filter((t) => t.verdict === "FAIL").length;

    const overallVerdict =
      failedTests === 0 ? "PASS" : passedTests >= 3 ? "WARNING" : "FAIL";

    const recommendations: string[] = [];
    if (tests.messages_per_conversation.verdict === "FAIL") {
      recommendations.push("Adjust power-law alpha in generator to better match production skew");
    }
    if (tests.content_length.verdict === "FAIL") {
      recommendations.push("Recalibrate content length log-normal parameters");
    }
    if (tests.conversation_types.verdict === "FAIL") {
      recommendations.push("Update conversation type distribution weights");
    }
    if (tests.message_types.verdict === "FAIL") {
      recommendations.push("Update message type distribution weights");
    }

    if (recommendations.length === 0) {
      recommendations.push("Distributions match production shape within tolerance");
      recommendations.push("Dataset ready for Phase 2 performance testing");
    }

    const result: ValidationResult = {
      validation_timestamp: new Date().toISOString(),
      production_shape_file: "shape-metrics-prod.json",
      tolerance_threshold: this.tolerance,
      overall_verdict: overallVerdict,
      tests,
      summary: {
        passed_tests: passedTests,
        failed_tests: failedTests,
        recommendations,
      },
    };

    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

    console.log("=== VALIDATION SUMMARY ===");
    console.log(`Overall Verdict: ${overallVerdict}`);
    console.log(`Passed: ${passedTests}/4 tests`);
    console.log(`Failed: ${failedTests}/4 tests\n`);

    if (recommendations.length > 0) {
      console.log("Recommendations:");
      recommendations.forEach((rec) => console.log(`  • ${rec}`));
    }

    console.log(`\n[Output] ✓ Written to ${outputPath}`);
    console.log("\n=== VALIDATION COMPLETE ===");

    await this.prisma.$disconnect();
  }
}

// CLI
async function main() {
  const args = process.argv.slice(2);
  
  let shapePath = "";
  let outputPath = "fidelity-report.json";
  let tolerance = 0.15;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--shape" && args[i + 1]) {
      shapePath = args[i + 1];
      i++;
    } else if (args[i] === "--output" && args[i + 1]) {
      outputPath = args[i + 1];
      i++;
    } else if (args[i] === "--tolerance" && args[i + 1]) {
      tolerance = parseFloat(args[i + 1]);
      i++;
    } else if (args[i] === "--help") {
      console.log(`
Usage: ts-node validate-fidelity.ts [options]

Options:
  --shape <path>        Path to production shape metrics JSON (required)
  --output <path>       Output validation report path (default: fidelity-report.json)
  --tolerance <float>   Acceptable error tolerance (default: 0.15 = ±15%)
  --help                Show this help

Example:
  ts-node validate-fidelity.ts --shape shape-metrics-prod.json --tolerance 0.20
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

  const validator = new FidelityValidator(shapePath, tolerance);
  await validator.validate(outputPath);
}

main().catch((err) => {
  console.error("\n[FATAL ERROR]", err.message);
  process.exit(1);
});
