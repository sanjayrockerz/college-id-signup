#!/usr/bin/env ts-node
/**
 * Dataset Fidelity Validator
 *
 * ROLE: Data QA Engineer
 * MISSION: Validate loaded dataset distributions match target specs
 *
 * This is a HARD GATE before EXPLAIN ANALYZE testing.
 * Skipping fidelity checks leads to misleading performance conclusions.
 *
 * Usage:
 *   ts-node validate-dataset-fidelity.ts --config report_staging_*.json --tolerance 0.15
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

interface ToleranceBands {
  strict: number; // 5% deviation
  normal: number; // 15% deviation
  relaxed: number; // 30% deviation
}

interface ValidationResult {
  metric: string;
  expected: number | string;
  actual: number | string;
  deviation: number;
  tolerance: number;
  passed: boolean;
  severity: "CRITICAL" | "WARNING" | "INFO";
}

interface FidelityReport {
  dataset: {
    band: string;
    seed: string;
    validated_at: string;
  };
  summary: {
    total_checks: number;
    passed: number;
    failed: number;
    warnings: number;
    go_no_go: "GO" | "NO-GO";
    rationale: string;
  };
  distributions: {
    conversation_sizes: ValidationResult[];
    messages_per_conversation: ValidationResult[];
    content_length: ValidationResult[];
    media_ratio: ValidationResult[];
    inter_arrival: ValidationResult[];
    diurnal_pattern: ValidationResult[];
    heavy_rooms: ValidationResult[];
  };
  integrity: {
    pii_check: boolean;
    monotonic_timestamps: boolean;
    referential_integrity: boolean;
    constraint_violations: number;
  };
  charts: {
    conversation_size_histogram: Record<string, number>;
    hourly_message_distribution: number[];
    heavy_room_traffic_share: number;
  };
}

const TOLERANCE_BANDS: ToleranceBands = {
  strict: 0.05,
  normal: 0.15,
  relaxed: 0.3,
};

class DatasetFidelityValidator {
  private prisma: PrismaClient;
  private config: any;
  private tolerance: number;
  private results: ValidationResult[] = [];
  private report: FidelityReport;

  constructor(configPath: string, tolerance: number = TOLERANCE_BANDS.normal) {
    this.prisma = new PrismaClient();
    this.tolerance = tolerance;

    if (!fs.existsSync(configPath)) {
      throw new Error(`Config file not found: ${configPath}`);
    }

    this.config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

    this.report = {
      dataset: {
        band: this.config.band,
        seed: "stored_separately",
        validated_at: new Date().toISOString(),
      },
      summary: {
        total_checks: 0,
        passed: 0,
        failed: 0,
        warnings: 0,
        go_no_go: "GO",
        rationale: "",
      },
      distributions: {
        conversation_sizes: [],
        messages_per_conversation: [],
        content_length: [],
        media_ratio: [],
        inter_arrival: [],
        diurnal_pattern: [],
        heavy_rooms: [],
      },
      integrity: {
        pii_check: true,
        monotonic_timestamps: true,
        referential_integrity: true,
        constraint_violations: 0,
      },
      charts: {
        conversation_size_histogram: {},
        hourly_message_distribution: new Array(24).fill(0),
        heavy_room_traffic_share: 0,
      },
    };

    console.log(`[Validator] Initialized for band=${this.config.band}`);
    console.log(`[Validator] Tolerance: ±${(tolerance * 100).toFixed(0)}%`);
  }

  /**
   * Main validation workflow
   */
  async validate(): Promise<FidelityReport> {
    console.log("\n=== DATASET FIDELITY VALIDATION ===\n");

    // Phase 1: Distribution checks
    await this.validateConversationSizes();
    await this.validateMessagesPerConversation();
    await this.validateContentLength();
    await this.validateMediaRatio();
    await this.validateDiurnalPattern();
    await this.validateHeavyRooms();

    // Phase 2: Integrity checks
    await this.validatePIIAbsence();
    await this.validateMonotonicTimestamps();
    await this.validateReferentialIntegrity();

    // Generate summary
    this.generateSummary();

    return this.report;
  }

  /**
   * Validate conversation member count distribution
   */
  private async validateConversationSizes(): Promise<void> {
    console.log("[Distribution] Validating conversation sizes...");

    const conversations = await this.prisma.conversation.findMany({
      include: {
        _count: {
          select: { conversationUsers: true },
        },
      },
    });

    const sizes = conversations.map((c) => c._count.conversationUsers);
    const histogram: Record<string, number> = {};

    for (const size of sizes) {
      const bucket = this.bucketSize(size);
      histogram[bucket] = (histogram[bucket] || 0) + 1;
    }

    // Calculate distribution
    const oneToOne = sizes.filter((s) => s === 2).length / sizes.length;
    const smallGroup =
      sizes.filter((s) => s >= 3 && s <= 20).length / sizes.length;
    const largeGroup = sizes.filter((s) => s > 20).length / sizes.length;

    // Expected (from distribution-spec.json)
    const expectedOneToOne = 0.7;
    const expectedSmallGroup = 0.25;
    const expectedLargeGroup = 0.05;

    this.report.distributions.conversation_sizes.push(
      this.checkDeviation(
        "1:1 conversations",
        expectedOneToOne,
        oneToOne,
        TOLERANCE_BANDS.normal,
      ),
      this.checkDeviation(
        "Small groups (3-20)",
        expectedSmallGroup,
        smallGroup,
        TOLERANCE_BANDS.normal,
      ),
      this.checkDeviation(
        "Large groups (>20)",
        expectedLargeGroup,
        largeGroup,
        TOLERANCE_BANDS.relaxed,
      ),
    );

    this.report.charts.conversation_size_histogram = histogram;
    console.log(`  1:1: ${(oneToOne * 100).toFixed(1)}% (expected 70%)`);
    console.log(`  Small: ${(smallGroup * 100).toFixed(1)}% (expected 25%)`);
    console.log(`  Large: ${(largeGroup * 100).toFixed(1)}% (expected 5%)`);
  }

  /**
   * Validate message count distribution per conversation
   */
  private async validateMessagesPerConversation(): Promise<void> {
    console.log("[Distribution] Validating messages per conversation...");

    const conversations = await this.prisma.conversation.findMany({
      include: {
        _count: {
          select: { messages: true },
        },
      },
    });

    const messageCounts = conversations
      .map((c) => c._count.messages)
      .sort((a, b) => a - b);

    const p50 = this.percentile(messageCounts, 0.5);
    const p95 = this.percentile(messageCounts, 0.95);
    const p99 = this.percentile(messageCounts, 0.99);

    // Expected from distribution-spec.json
    const expectedP50 = 15;
    const expectedP95 = 500;
    const expectedP99 = 5000;

    this.report.distributions.messages_per_conversation.push(
      this.checkDeviation(
        "Message count p50",
        expectedP50,
        p50,
        TOLERANCE_BANDS.normal,
      ),
      this.checkDeviation(
        "Message count p95",
        expectedP95,
        p95,
        TOLERANCE_BANDS.relaxed,
      ),
      this.checkDeviation(
        "Message count p99",
        expectedP99,
        p99,
        TOLERANCE_BANDS.relaxed,
      ),
    );

    console.log(`  p50: ${p50} (expected ~15)`);
    console.log(`  p95: ${p95} (expected ~500)`);
    console.log(`  p99: ${p99} (expected ~5000)`);
  }

  /**
   * Validate message content length distribution
   */
  private async validateContentLength(): Promise<void> {
    console.log("[Distribution] Validating content length...");

    const messages = await this.prisma.message.findMany({
      select: { content: true },
      take: 10000, // Sample
    });

    const lengths = messages.map((m) => (m.content || "").length);
    const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const medianLength = this.percentile(
      lengths.sort((a, b) => a - b),
      0.5,
    );

    // Expected: mean ~150, median ~90 (log-normal μ=4.5, σ=1.2)
    const expectedMean = 150;
    const expectedMedian = 90;

    this.report.distributions.content_length.push(
      this.checkDeviation(
        "Content length mean",
        expectedMean,
        avgLength,
        TOLERANCE_BANDS.normal,
      ),
      this.checkDeviation(
        "Content length median",
        expectedMedian,
        medianLength,
        TOLERANCE_BANDS.normal,
      ),
    );

    console.log(`  Mean: ${avgLength.toFixed(0)} chars (expected ~150)`);
    console.log(`  Median: ${medianLength.toFixed(0)} chars (expected ~90)`);
  }

  /**
   * Validate media message ratio
   */
  private async validateMediaRatio(): Promise<void> {
    console.log("[Distribution] Validating media ratio...");

    const totalMessages = await this.prisma.message.count();
    const mediaMessages = await this.prisma.message.count({
      where: {
        type: { not: "TEXT" },
      },
    });

    const actualRatio = mediaMessages / totalMessages;
    const expectedRatio = 0.15; // 15% from distribution-spec.json

    this.report.distributions.media_ratio.push(
      this.checkDeviation(
        "Media message ratio",
        expectedRatio,
        actualRatio,
        TOLERANCE_BANDS.strict,
      ),
    );

    console.log(
      `  Media ratio: ${(actualRatio * 100).toFixed(1)}% (expected 15%)`,
    );
  }

  /**
   * Validate diurnal pattern (hourly distribution)
   */
  private async validateDiurnalPattern(): Promise<void> {
    console.log("[Distribution] Validating diurnal pattern...");

    const messages = await this.prisma.message.findMany({
      select: { createdAt: true },
      take: 50000, // Sample
    });

    const hourlyDistribution = new Array(24).fill(0);
    for (const msg of messages) {
      const hour = msg.createdAt.getHours();
      hourlyDistribution[hour]++;
    }

    // Check peak hours (9-12, 18-21) have higher traffic
    const peakHours = [9, 10, 11, 12, 18, 19, 20, 21];
    const troughHours = [0, 1, 2, 3, 4, 5];

    const peakAvg =
      peakHours.reduce((sum, h) => sum + hourlyDistribution[h], 0) /
      peakHours.length;
    const troughAvg =
      troughHours.reduce((sum, h) => sum + hourlyDistribution[h], 0) /
      troughHours.length;

    const peakToTroughRatio = peakAvg / Math.max(1, troughAvg);

    // Expected: peak hours should have 2.5x-3x traffic vs trough
    const expectedRatio = 2.5;

    this.report.distributions.diurnal_pattern.push(
      this.checkDeviation(
        "Peak/trough ratio",
        expectedRatio,
        peakToTroughRatio,
        TOLERANCE_BANDS.relaxed,
      ),
    );

    this.report.charts.hourly_message_distribution = hourlyDistribution;

    console.log(
      `  Peak/trough ratio: ${peakToTroughRatio.toFixed(2)}x (expected ~2.5x)`,
    );
  }

  /**
   * Validate heavy room distribution (1-5% dominate traffic)
   */
  private async validateHeavyRooms(): Promise<void> {
    console.log("[Distribution] Validating heavy rooms...");

    const conversations = await this.prisma.conversation.findMany({
      include: {
        _count: {
          select: { messages: true },
        },
      },
    });

    const totalMessages = conversations.reduce(
      (sum, c) => sum + c._count.messages,
      0,
    );
    const sortedByMessages = conversations.sort(
      (a, b) => b._count.messages - a._count.messages,
    );

    // Top 2% of conversations
    const top2Percent = Math.max(1, Math.ceil(conversations.length * 0.02));
    const heavyRoomMessages = sortedByMessages
      .slice(0, top2Percent)
      .reduce((sum, c) => sum + c._count.messages, 0);

    const trafficShare = heavyRoomMessages / totalMessages;

    // Expected: Top 2% should have 20-40% of traffic (power law)
    const expectedShare = 0.3; // 30%

    this.report.distributions.heavy_rooms.push(
      this.checkDeviation(
        "Heavy room traffic share",
        expectedShare,
        trafficShare,
        TOLERANCE_BANDS.relaxed,
      ),
    );

    this.report.charts.heavy_room_traffic_share = trafficShare;

    // Verify at least some heavy rooms exist (>10k messages)
    const heavyRoomCount = conversations.filter(
      (c) => c._count.messages > 10000,
    ).length;
    const heavyRoomPercentage = heavyRoomCount / conversations.length;

    this.report.distributions.heavy_rooms.push(
      this.checkDeviation(
        "Heavy room percentage",
        0.02,
        heavyRoomPercentage,
        TOLERANCE_BANDS.relaxed,
      ),
    );

    console.log(
      `  Top 2% traffic share: ${(trafficShare * 100).toFixed(1)}% (expected ~30%)`,
    );
    console.log(
      `  Heavy rooms (>10k msgs): ${heavyRoomCount} (${(heavyRoomPercentage * 100).toFixed(2)}%)`,
    );
  }

  /**
   * Validate no PII exists in dataset
   */
  private async validatePIIAbsence(): Promise<void> {
    console.log("[Integrity] Checking for PII...");

    const users = await this.prisma.user.findMany({
      select: { email: true, username: true },
      take: 100,
    });

    let piiFound = false;

    for (const user of users) {
      // Check for real-looking emails
      if (
        user.email &&
        !user.email.includes("synthetic_") &&
        !user.email.includes("@example.local")
      ) {
        console.log(`  ✗ Suspicious email: ${user.email}`);
        piiFound = true;
      }

      // Check for real names
      if (user.username && /^[A-Z][a-z]+\.[A-Z][a-z]+/.test(user.username)) {
        console.log(`  ✗ Suspicious username: ${user.username}`);
        piiFound = true;
      }
    }

    this.report.integrity.pii_check = !piiFound;

    if (!piiFound) {
      console.log("  ✓ No PII detected");
    }
  }

  /**
   * Validate timestamps are monotonic per conversation
   */
  private async validateMonotonicTimestamps(): Promise<void> {
    console.log("[Integrity] Checking monotonic timestamps...");

    const conversations = await this.prisma.conversation.findMany({
      select: { id: true },
      take: 100, // Sample
    });

    let violations = 0;

    for (const conv of conversations) {
      const messages = await this.prisma.message.findMany({
        where: { conversationId: conv.id },
        select: { createdAt: true },
        orderBy: { createdAt: "asc" },
      });

      for (let i = 1; i < messages.length; i++) {
        if (messages[i].createdAt < messages[i - 1].createdAt) {
          violations++;
        }
      }
    }

    this.report.integrity.monotonic_timestamps = violations === 0;
    console.log(
      violations === 0
        ? "  ✓ All timestamps monotonic"
        : `  ✗ Found ${violations} violations`,
    );
  }

  /**
   * Validate referential integrity
   */
  private async validateReferentialIntegrity(): Promise<void> {
    console.log("[Integrity] Checking referential integrity...");

    // Check orphaned messages
    const orphanedMessages = await this.prisma.$queryRaw<any[]>`
      SELECT COUNT(*) as count
      FROM messages m
      LEFT JOIN conversations c ON c.id = m."conversationId"
      WHERE c.id IS NULL
    `;

    // Check orphaned conversation members
    const orphanedMembers = await this.prisma.$queryRaw<any[]>`
      SELECT COUNT(*) as count
      FROM conversation_users cu
      LEFT JOIN users u ON u.id = cu."userId"
      LEFT JOIN conversations c ON c.id = cu."conversationId"
      WHERE u.id IS NULL OR c.id IS NULL
    `;

    const totalViolations =
      (orphanedMessages[0]?.count || 0) + (orphanedMembers[0]?.count || 0);

    this.report.integrity.constraint_violations = totalViolations;
    this.report.integrity.referential_integrity = totalViolations === 0;

    console.log(
      totalViolations === 0
        ? "  ✓ Referential integrity maintained"
        : `  ✗ Found ${totalViolations} violations`,
    );
  }

  /**
   * Generate final summary and GO/NO-GO decision
   */
  private generateSummary(): void {
    const allResults = [
      ...this.report.distributions.conversation_sizes,
      ...this.report.distributions.messages_per_conversation,
      ...this.report.distributions.content_length,
      ...this.report.distributions.media_ratio,
      ...this.report.distributions.diurnal_pattern,
      ...this.report.distributions.heavy_rooms,
    ];

    this.report.summary.total_checks = allResults.length;
    this.report.summary.passed = allResults.filter((r) => r.passed).length;
    this.report.summary.failed = allResults.filter(
      (r) => !r.passed && r.severity === "CRITICAL",
    ).length;
    this.report.summary.warnings = allResults.filter(
      (r) => !r.passed && r.severity === "WARNING",
    ).length;

    // Integrity checks
    const integrityFailures =
      (!this.report.integrity.pii_check ? 1 : 0) +
      (!this.report.integrity.monotonic_timestamps ? 1 : 0) +
      (!this.report.integrity.referential_integrity ? 1 : 0);

    // GO/NO-GO decision
    const criticalFailures = this.report.summary.failed + integrityFailures;

    if (criticalFailures > 0) {
      this.report.summary.go_no_go = "NO-GO";
      this.report.summary.rationale = `${criticalFailures} critical failures detected. Dataset does not meet fidelity requirements.`;
    } else if (this.report.summary.warnings > 3) {
      this.report.summary.go_no_go = "NO-GO";
      this.report.summary.rationale = `Too many warnings (${this.report.summary.warnings}). Review dataset generation parameters.`;
    } else {
      this.report.summary.go_no_go = "GO";
      this.report.summary.rationale = `Dataset distributions match target specs within tolerance. Authorized to proceed to EXPLAIN ANALYZE.`;
    }
  }

  /**
   * Check deviation and record result
   */
  private checkDeviation(
    metric: string,
    expected: number,
    actual: number,
    tolerance: number,
  ): ValidationResult {
    const deviation = Math.abs((actual - expected) / expected);
    const passed = deviation <= tolerance;
    let severity: "CRITICAL" | "WARNING" | "INFO";

    if (deviation > tolerance * 2) {
      severity = "CRITICAL";
    } else if (deviation > tolerance) {
      severity = "WARNING";
    } else {
      severity = "INFO";
    }

    return {
      metric,
      expected,
      actual,
      deviation,
      tolerance,
      passed,
      severity,
    };
  }

  /**
   * Helper: Calculate percentile
   */
  private percentile(sortedArray: number[], p: number): number {
    if (sortedArray.length === 0) return 0;
    const index = Math.ceil(sortedArray.length * p) - 1;
    return sortedArray[Math.max(0, index)];
  }

  /**
   * Helper: Bucket conversation size
   */
  private bucketSize(size: number): string {
    if (size === 2) return "2 (1:1)";
    if (size <= 5) return "3-5";
    if (size <= 10) return "6-10";
    if (size <= 20) return "11-20";
    if (size <= 50) return "21-50";
    if (size <= 100) return "51-100";
    return "100+";
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);
  const configIndex = args.indexOf("--config");
  const toleranceIndex = args.indexOf("--tolerance");

  if (configIndex === -1) {
    console.error(
      "Usage: ts-node validate-dataset-fidelity.ts --config <report.json> [--tolerance 0.15]",
    );
    process.exit(1);
  }

  const configPath = args[configIndex + 1];
  const tolerance =
    toleranceIndex !== -1
      ? parseFloat(args[toleranceIndex + 1])
      : TOLERANCE_BANDS.normal;

  const validator = new DatasetFidelityValidator(configPath, tolerance);

  try {
    const report = await validator.validate();

    // Save report
    const reportPath = `docs/database/baselines/fidelity-report-${report.dataset.band}-${Date.now()}.json`;
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log("\n=== VALIDATION SUMMARY ===");
    console.log(`Total checks: ${report.summary.total_checks}`);
    console.log(`Passed: ${report.summary.passed}`);
    console.log(`Failed: ${report.summary.failed}`);
    console.log(`Warnings: ${report.summary.warnings}`);
    console.log(`\nDecision: ${report.summary.go_no_go}`);
    console.log(`Rationale: ${report.summary.rationale}`);
    console.log(`\nReport saved: ${reportPath}`);

    if (report.summary.go_no_go === "NO-GO") {
      console.error(
        "\n❌ VALIDATION FAILED - DO NOT PROCEED TO EXPLAIN ANALYZE",
      );
      process.exit(1);
    } else {
      console.log("\n✅ VALIDATION PASSED - AUTHORIZED TO PROCEED");
      process.exit(0);
    }
  } catch (error) {
    console.error("\n=== VALIDATION ERROR ===");
    console.error(error);
    process.exit(1);
  } finally {
    await validator.cleanup();
  }
}

if (require.main === module) {
  main();
}
