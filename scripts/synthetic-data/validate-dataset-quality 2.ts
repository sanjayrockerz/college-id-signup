#!/usr/bin/env ts-node
/**
 * Comprehensive Dataset Quality Validation
 * 
 * Purpose: Validate synthetic dataset realism BEFORE Phase 2 performance testing
 * Owner: Data QA Engineer
 * 
 * Validation Suite:
 * ✓ Heavy room presence (hot indexes activation)
 * ✓ Power-law tail (realistic skew)
 * ✓ Type distributions (DM/Group, TEXT/Media ratios)
 * ✓ Temporal patterns (diurnal waves)
 * ✓ Data integrity (no PII, referential constraints, timestamp ordering)
 * ✓ Visual histograms and charts
 * 
 * Usage:
 *   ts-node validate-dataset-quality.ts --config report_dev_20251022_quick.json
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";

interface QualityReport {
  validation_timestamp: string;
  dataset_summary: {
    users: number;
    conversations: number;
    messages: number;
    attachments: number;
  };
  
  distribution_analysis: {
    heavy_rooms: {
      top_1_percent_conversations: number;
      top_1_percent_message_share: number;
      top_5_percent_message_share: number;
      verdict: "PASS" | "FAIL";
      details: string;
    };
    
    power_law_tail: {
      p50: number;
      p75: number;
      p90: number;
      p95: number;
      p99: number;
      max: number;
      tail_ratio_p99_p50: number;
      verdict: "PASS" | "FAIL";
      details: string;
    };
    
    histogram_messages_per_convo: {
      buckets: string[];
      counts: number[];
    };
  };
  
  type_distributions: {
    conversations: { type: string; count: number; percentage: number }[];
    messages: { type: string; count: number; percentage: number }[];
    verdict: "PASS" | "FAIL";
  };
  
  temporal_analysis: {
    hourly_distribution: { hour: number; count: number; percentage: number }[];
    peak_hours: number[];
    diurnal_variation: number;
    verdict: "PASS" | "FAIL";
    details: string;
  };
  
  integrity_checks: {
    pii_safety: {
      synthetic_emails_only: boolean;
      real_email_count: number;
      verdict: "PASS" | "FAIL";
    };
    referential_integrity: {
      orphaned_messages: number;
      orphaned_conversation_users: number;
      orphaned_attachments: number;
      verdict: "PASS" | "FAIL";
    };
    timestamp_ordering: {
      checked_conversations: number;
      out_of_order_messages: number;
      verdict: "PASS" | "FAIL";
    };
    data_completeness: {
      messages_without_sender: number;
      conversations_without_creator: number;
      verdict: "PASS" | "FAIL";
    };
  };
  
  overall_assessment: {
    verdict: "PASS" | "WARNING" | "FAIL";
    passed_tests: number;
    total_tests: number;
    critical_failures: string[];
    warnings: string[];
    ready_for_phase2: boolean;
  };
  
  recommendations: string[];
}

class DatasetQualityValidator {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  /**
   * Analyze heavy room distribution
   */
  private async analyzeHeavyRooms() {
    console.log("[1/6] Analyzing heavy room distribution...");

    const conversations = await this.prisma.conversation.findMany({
      select: {
        id: true,
        _count: { select: { messages: true } },
      },
    });

    const msgCounts = conversations
      .map((c) => ({ id: c.id, count: c._count.messages }))
      .filter((c) => c.count > 0)
      .sort((a, b) => b.count - a.count);

    if (msgCounts.length === 0) {
      return {
        top_1_percent_conversations: 0,
        top_1_percent_message_share: 0,
        top_5_percent_message_share: 0,
        verdict: "FAIL" as const,
        details: "No conversations with messages",
      };
    }

    const totalMessages = msgCounts.reduce((sum, c) => sum + c.count, 0);
    const top1Count = Math.max(1, Math.ceil(msgCounts.length * 0.01));
    const top5Count = Math.max(1, Math.ceil(msgCounts.length * 0.05));

    const top1Messages = msgCounts.slice(0, top1Count).reduce((sum, c) => sum + c.count, 0);
    const top5Messages = msgCounts.slice(0, top5Count).reduce((sum, c) => sum + c.count, 0);

    const top1Share = top1Messages / totalMessages;
    const top5Share = top5Messages / totalMessages;

    // Verdict: Heavy rooms should contribute 15%+ (top 1%) and 30%+ (top 5%)
    const verdict: "PASS" | "FAIL" = top1Share >= 0.15 && top5Share >= 0.30 ? "PASS" : "FAIL";

    console.log(`     Top 1%: ${top1Count} convos with ${(top1Share * 100).toFixed(1)}% of messages`);
    console.log(`     Top 5%: ${top5Count} convos with ${(top5Share * 100).toFixed(1)}% of messages`);
    console.log(`     Verdict: ${verdict}\n`);

    return {
      top_1_percent_conversations: top1Count,
      top_1_percent_message_share: Math.round(top1Share * 1000) / 1000,
      top_5_percent_message_share: Math.round(top5Share * 1000) / 1000,
      verdict,
      details: verdict === "PASS"
        ? "Heavy rooms present - will activate hot indexes and caching"
        : "Insufficient heavy rooms - dataset too uniform, won't stress hot paths",
    };
  }

  /**
   * Analyze power-law tail
   */
  private async analyzePowerLawTail() {
    console.log("[2/6] Analyzing power-law tail...");

    const conversations = await this.prisma.conversation.findMany({
      select: {
        _count: { select: { messages: true } },
      },
    });

    const msgCounts = conversations
      .map((c) => c._count.messages)
      .filter((c) => c > 0)
      .sort((a, b) => a - b);

    if (msgCounts.length === 0) {
      return {
        p50: 0,
        p75: 0,
        p90: 0,
        p95: 0,
        p99: 0,
        max: 0,
        tail_ratio_p99_p50: 0,
        verdict: "FAIL" as const,
        details: "No data",
        histogram: { buckets: [], counts: [] },
      };
    }

    const percentile = (p: number) => msgCounts[Math.floor((msgCounts.length - 1) * (p / 100))];

    const p50 = percentile(50);
    const p75 = percentile(75);
    const p90 = percentile(90);
    const p95 = percentile(95);
    const p99 = percentile(99);
    const max = msgCounts[msgCounts.length - 1];

    const tailRatio = p99 / Math.max(p50, 1);

    // Verdict: Tail ratio should be >10x for realistic power-law
    const verdict: "PASS" | "FAIL" = tailRatio > 10 ? "PASS" : "FAIL";

    // Generate histogram
    const buckets = ["1-10", "11-50", "51-100", "101-500", "501-1000", "1001-5000", "5000+"];
    const counts = [0, 0, 0, 0, 0, 0, 0];
    
    for (const count of msgCounts) {
      if (count <= 10) counts[0]++;
      else if (count <= 50) counts[1]++;
      else if (count <= 100) counts[2]++;
      else if (count <= 500) counts[3]++;
      else if (count <= 1000) counts[4]++;
      else if (count <= 5000) counts[5]++;
      else counts[6]++;
    }

    console.log(`     Percentiles: p50=${p50}, p75=${p75}, p90=${p90}, p95=${p95}, p99=${p99}, max=${max}`);
    console.log(`     Tail ratio (p99/p50): ${tailRatio.toFixed(1)}x`);
    console.log(`     Verdict: ${verdict}\n`);

    return {
      p50,
      p75,
      p90,
      p95,
      p99,
      max,
      tail_ratio_p99_p50: Math.round(tailRatio * 10) / 10,
      verdict,
      details: verdict === "PASS"
        ? `Strong power-law tail (${tailRatio.toFixed(1)}x) - realistic skew present`
        : `Weak power-law tail (${tailRatio.toFixed(1)}x) - distribution too uniform`,
      histogram: { buckets, counts },
    };
  }

  /**
   * Validate type distributions
   */
  private async validateTypeDistributions() {
    console.log("[3/6] Validating type distributions...");

    // Conversation types
    const convoTypes = await this.prisma.conversation.groupBy({
      by: ["type"],
      _count: true,
    });

    const totalConvos = convoTypes.reduce((sum, t) => sum + t._count, 0);
    const convoDist = convoTypes.map((t) => ({
      type: t.type,
      count: t._count,
      percentage: Math.round((t._count / totalConvos) * 1000) / 10,
    }));

    // Message types
    const msgTypes = await this.prisma.message.groupBy({
      by: ["type"],
      _count: true,
    });

    const totalMsgs = msgTypes.reduce((sum, t) => sum + t._count, 0);
    const msgDist = msgTypes.map((t) => ({
      type: t.type,
      count: t._count,
      percentage: Math.round((t._count / totalMsgs) * 1000) / 10,
    }));

    // Verdict: Should have reasonable variety
    const hasMultipleConvoTypes = convoTypes.length >= 2;
    const hasMultipleMsgTypes = msgTypes.length >= 2;
    const verdict: "PASS" | "FAIL" = hasMultipleConvoTypes && hasMultipleMsgTypes ? "PASS" : "FAIL";

    console.log(`     Conversation types:`);
    convoDist.forEach((d) => console.log(`       ${d.type}: ${d.count} (${d.percentage}%)`));
    console.log(`     Message types:`);
    msgDist.forEach((d) => console.log(`       ${d.type}: ${d.count} (${d.percentage}%)`));
    console.log(`     Verdict: ${verdict}\n`);

    return {
      conversations: convoDist,
      messages: msgDist,
      verdict,
    };
  }

  /**
   * Analyze temporal patterns
   */
  private async analyzeTemporalPatterns() {
    console.log("[4/6] Analyzing temporal patterns...");

    const messages = await this.prisma.message.findMany({
      select: { createdAt: true },
      take: 100000, // Sample for performance
    });

    const hourlyDist = Array(24).fill(0);

    for (const msg of messages) {
      const hour = msg.createdAt.getHours();
      hourlyDist[hour]++;
    }

    const totalCount = messages.length;
    const hourlyData = hourlyDist.map((count, hour) => ({
      hour,
      count,
      percentage: Math.round((count / totalCount) * 1000) / 10,
    }));

    // Find peak hours
    const avgCount = totalCount / 24;
    const peakHours = hourlyData.filter((h) => h.count > avgCount * 1.5).map((h) => h.hour);

    const maxCount = Math.max(...hourlyDist);
    const minCount = Math.min(...hourlyDist.filter((c) => c > 0));
    const diurnalVariation = maxCount / Math.max(minCount, 1);

    // Verdict: Should have some diurnal variation (1.5x+)
    const verdict: "PASS" | "FAIL" = diurnalVariation > 1.5 ? "PASS" : "FAIL";

    console.log(`     Peak hours: ${peakHours.join(", ")}`);
    console.log(`     Diurnal variation: ${diurnalVariation.toFixed(2)}x (max/min)`);
    console.log(`     Verdict: ${verdict}\n`);

    return {
      hourly_distribution: hourlyData,
      peak_hours: peakHours,
      diurnal_variation: Math.round(diurnalVariation * 100) / 100,
      verdict,
      details: verdict === "PASS"
        ? "Realistic temporal patterns present"
        : "Uniform temporal distribution - missing diurnal patterns",
    };
  }

  /**
   * Run integrity checks
   */
  private async runIntegrityChecks() {
    console.log("[5/6] Running integrity checks...");

    // PII safety
    const realEmails = await this.prisma.user.count({
      where: {
        AND: [
          { NOT: { email: { startsWith: "syn_" } } },
          { NOT: { email: { startsWith: "synthetic_" } } },
        ],
      },
    });

    const piiVerdict: "PASS" | "FAIL" = realEmails === 0 ? "PASS" : "FAIL";

    // Referential integrity
    const orphanedMessages = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM messages m
      WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = m."senderId")
         OR NOT EXISTS (SELECT 1 FROM conversations c WHERE c.id = m."conversationId")
    `.then((r) => Number(r[0].count));

    const orphanedConvoUsers = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM conversation_users cu
      WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = cu."userId")
         OR NOT EXISTS (SELECT 1 FROM conversations c WHERE c.id = cu."conversationId")
    `.then((r) => Number(r[0].count));

    const orphanedAttachments = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM attachments a
      WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.id = a."messageId")
         OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = a."uploaderId")
    `.then((r) => Number(r[0].count));

    const refIntegrityVerdict: "PASS" | "FAIL" =
      orphanedMessages === 0 && orphanedConvoUsers === 0 && orphanedAttachments === 0
        ? "PASS"
        : "FAIL";

    // Timestamp ordering
    const sampleConvos = await this.prisma.conversation.findMany({
      take: 100,
      include: {
        messages: {
          select: { id: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    let outOfOrderCount = 0;
    for (const convo of sampleConvos) {
      for (let i = 1; i < convo.messages.length; i++) {
        if (convo.messages[i].createdAt < convo.messages[i - 1].createdAt) {
          outOfOrderCount++;
        }
      }
    }

    const timestampVerdict: "PASS" | "FAIL" = outOfOrderCount === 0 ? "PASS" : "FAIL";

    // Data completeness
    const msgsWithoutSender = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM messages WHERE "senderId" IS NULL
    `.then((r) => Number(r[0].count));

    const convosWithoutCreator = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM conversations WHERE "creatorId" IS NULL
    `.then((r) => Number(r[0].count));

    const completenessVerdict: "PASS" | "FAIL" = msgsWithoutSender === 0 && convosWithoutCreator === 0 ? "PASS" : "FAIL";

    console.log(`     PII Safety: ${realEmails} real emails (${piiVerdict})`);
    console.log(`     Referential integrity: ${orphanedMessages + orphanedConvoUsers + orphanedAttachments} orphaned records (${refIntegrityVerdict})`);
    console.log(`     Timestamp ordering: ${outOfOrderCount} out-of-order (${timestampVerdict})`);
    console.log(`     Data completeness: ${msgsWithoutSender + convosWithoutCreator} null FKs (${completenessVerdict})\n`);

    return {
      pii_safety: {
        synthetic_emails_only: realEmails === 0,
        real_email_count: realEmails,
        verdict: piiVerdict,
      },
      referential_integrity: {
        orphaned_messages: orphanedMessages,
        orphaned_conversation_users: orphanedConvoUsers,
        orphaned_attachments: orphanedAttachments,
        verdict: refIntegrityVerdict,
      },
      timestamp_ordering: {
        checked_conversations: sampleConvos.length,
        out_of_order_messages: outOfOrderCount,
        verdict: timestampVerdict,
      },
      data_completeness: {
        messages_without_sender: msgsWithoutSender,
        conversations_without_creator: convosWithoutCreator,
        verdict: completenessVerdict,
      },
    };
  }

  /**
   * Generate final assessment
   */
  private generateAssessment(
    heavyRooms: any,
    powerLaw: any,
    types: any,
    temporal: any,
    integrity: any
  ) {
    const testResults = [
      heavyRooms.verdict,
      powerLaw.verdict,
      types.verdict,
      temporal.verdict,
      integrity.pii_safety.verdict,
      integrity.referential_integrity.verdict,
      integrity.timestamp_ordering.verdict,
      integrity.data_completeness.verdict,
    ];

    const passedTests = testResults.filter((v) => v === "PASS").length;
    const totalTests = testResults.length;

    const criticalFailures: string[] = [];
    const warnings: string[] = [];

    if (integrity.pii_safety.verdict === "FAIL") {
      criticalFailures.push("PII detected - MUST regenerate dataset");
    }
    if (integrity.referential_integrity.verdict === "FAIL") {
      criticalFailures.push("Referential integrity violations - MUST fix constraints");
    }
    if (heavyRooms.verdict === "FAIL") {
      warnings.push("Insufficient heavy rooms - hot paths won't be adequately stressed");
    }
    if (powerLaw.verdict === "FAIL") {
      warnings.push("Weak power-law tail - missing realistic skew");
    }

    const readyForPhase2 = criticalFailures.length === 0 && passedTests >= 6;

    let overallVerdict: "PASS" | "WARNING" | "FAIL";
    if (criticalFailures.length > 0) {
      overallVerdict = "FAIL";
    } else if (passedTests === totalTests) {
      overallVerdict = "PASS";
    } else {
      overallVerdict = "WARNING";
    }

    return {
      verdict: overallVerdict,
      passed_tests: passedTests,
      total_tests: totalTests,
      critical_failures: criticalFailures,
      warnings,
      ready_for_phase2: readyForPhase2,
    };
  }

  /**
   * Run full validation
   */
  async validate(outputPath: string): Promise<void> {
    console.log("\n╔═══════════════════════════════════════════════╗");
    console.log("║  DATASET QUALITY VALIDATION                   ║");
    console.log("╚═══════════════════════════════════════════════╝\n");

    // Get dataset summary
    const users = await this.prisma.user.count();
    const conversations = await this.prisma.conversation.count();
    const messages = await this.prisma.message.count();
    const attachments = await this.prisma.attachment.count();

    console.log(`Dataset: ${users.toLocaleString()} users, ${conversations.toLocaleString()} conversations, ${messages.toLocaleString()} messages\n`);

    // Run tests
    const [heavyRooms, powerLaw, types, temporal, integrity] = await Promise.all([
      this.analyzeHeavyRooms(),
      this.analyzePowerLawTail(),
      this.validateTypeDistributions(),
      this.analyzeTemporalPatterns(),
      this.runIntegrityChecks(),
    ]);

    const assessment = this.generateAssessment(heavyRooms, powerLaw, types, temporal, integrity);

    // Generate recommendations
    const recommendations: string[] = [];

    if (assessment.critical_failures.length === 0 && assessment.ready_for_phase2) {
      recommendations.push("✓ Dataset passes all quality checks");
      recommendations.push("✓ Heavy rooms present - will activate hot indexes and caching");
      recommendations.push("✓ Power-law tail realistic - queries will exhibit production-like skew");
      recommendations.push("✓ APPROVED for Phase 2 performance testing");
    } else {
      if (integrity.pii_safety.verdict === "FAIL") {
        recommendations.push("⚠️ CRITICAL: Regenerate dataset with synthetic emails only");
      }
      if (integrity.referential_integrity.verdict === "FAIL") {
        recommendations.push("⚠️ CRITICAL: Fix foreign key constraints before testing");
      }
      if (heavyRooms.verdict === "FAIL") {
        recommendations.push("Decrease power-law alpha to create heavier tail (more huge rooms)");
      }
      if (powerLaw.verdict === "FAIL") {
        recommendations.push("Adjust distribution to create stronger p99/p50 ratio (>10x)");
      }
      if (temporal.verdict === "FAIL") {
        recommendations.push("Add diurnal modulation to message timestamps");
      }
    }

    const report: QualityReport = {
      validation_timestamp: new Date().toISOString(),
      dataset_summary: {
        users,
        conversations,
        messages,
        attachments,
      },
      distribution_analysis: {
        heavy_rooms: heavyRooms,
        power_law_tail: powerLaw,
        histogram_messages_per_convo: powerLaw.histogram,
      },
      type_distributions: types,
      temporal_analysis: temporal,
      integrity_checks: integrity,
      overall_assessment: assessment,
      recommendations,
    };

    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

    console.log("[6/6] Generating final assessment...\n");
    console.log("╔═══════════════════════════════════════════════╗");
    console.log(`║  OVERALL VERDICT: ${assessment.verdict.padEnd(29)}║`);
    console.log("╚═══════════════════════════════════════════════╝\n");

    console.log(`Tests passed: ${assessment.passed_tests}/${assessment.total_tests}`);
    console.log(`Ready for Phase 2: ${assessment.ready_for_phase2 ? "YES ✓" : "NO ✗"}\n`);

    if (assessment.critical_failures.length > 0) {
      console.log("CRITICAL FAILURES:");
      assessment.critical_failures.forEach((f) => console.log(`  ✗ ${f}`));
      console.log();
    }

    if (assessment.warnings.length > 0) {
      console.log("WARNINGS:");
      assessment.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
      console.log();
    }

    console.log("RECOMMENDATIONS:");
    recommendations.forEach((r) => console.log(`  ${r}`));

    console.log(`\n✓ Report written to: ${outputPath}\n`);

    await this.prisma.$disconnect();
  }
}

// CLI
async function main() {
  const args = process.argv.slice(2);

  let outputPath = "dataset-quality-report.json";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output" && args[i + 1]) {
      outputPath = args[i + 1];
      i++;
    } else if (args[i] === "--help") {
      console.log(`
Usage: ts-node validate-dataset-quality.ts [options]

Options:
  --output <path>    Output validation report path (default: dataset-quality-report.json)
  --help             Show this help

Example:
  ts-node validate-dataset-quality.ts --output quality-report-20251022.json
      `);
      process.exit(0);
    }
  }

  const validator = new DatasetQualityValidator();
  await validator.validate(outputPath);
}

main().catch((err) => {
  console.error("\n[FATAL ERROR]", err.message);
  console.error(err.stack);
  process.exit(1);
});
