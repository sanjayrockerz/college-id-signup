#!/usr/bin/env ts-node
/**
 * Database Performance Validator - Index Efficacy & Query Plan Analysis
 *
 * Purpose: Execute EXPLAIN ANALYZE suite on realistic dataset to validate:
 * - Composite index usage (conversationId, createdAt DESC)
 * - Absence of Sort operations (index provides order)
 * - p50/p95 latency improvements
 * - Buffer cache efficiency
 *
 * Usage:
 *   ts-node validate-index-performance.ts [--sample-size 100] [--output report.json]
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";

interface QueryTest {
  name: string;
  description: string;
  sql: string;
  params?: any[];
  expectation: {
    index_used: string;
    no_sort: boolean;
    scan_type: "Index Scan" | "Index Only Scan" | "Bitmap Index Scan";
  };
}

interface PlanAnalysis {
  uses_index: boolean;
  index_name?: string;
  has_sort: boolean;
  scan_type: string;
  total_cost: number;
  startup_cost: number;
  rows_estimate: number;
  actual_time_ms: number;
  buffers?: {
    shared_hit: number;
    shared_read: number;
    shared_dirtied: number;
    shared_written: number;
  };
  warnings: string[];
}

interface QueryResult {
  test: QueryTest;
  execution_time_ms: number;
  rows_returned: number;
  plan: any;
  analysis: PlanAnalysis;
  verdict: "PASS" | "FAIL" | "WARN";
  issues: string[];
}

interface PerformanceReport {
  generated_at: string;
  dataset_stats: {
    users: number;
    conversations: number;
    messages: number;
  };
  test_results: QueryResult[];
  summary: {
    total_tests: number;
    passed: number;
    failed: number;
    warnings: number;
    overall_verdict: "PASS" | "FAIL" | "WARN";
  };
  latency_analysis: {
    p50_ms: number;
    p95_ms: number;
    p99_ms: number;
    max_ms: number;
  };
  recommendations: string[];
}

class PerformanceValidator {
  private prisma: PrismaClient;
  private sampleSize: number;
  private conversationIds: string[] = [];

  constructor(sampleSize: number = 100) {
    this.prisma = new PrismaClient();
    this.sampleSize = sampleSize;
  }

  /**
   * Sample representative conversations (mix of heavy and normal rooms)
   */
  private async sampleConversations(): Promise<void> {
    console.log(
      `[Sampling] Selecting ${this.sampleSize} representative conversations...\n`,
    );

    // Get conversation IDs with message counts
    const conversations = await this.prisma.$queryRaw<
      Array<{ id: string; msg_count: bigint }>
    >`
      SELECT c.id, COUNT(m.id) as msg_count
      FROM conversations c
      LEFT JOIN messages m ON m."conversationId" = c.id
      GROUP BY c.id
      HAVING COUNT(m.id) > 0
      ORDER BY RANDOM()
      LIMIT ${this.sampleSize}
    `;

    this.conversationIds = conversations.map((c) => c.id);

    const messageCounts = conversations.map((c) => Number(c.msg_count));
    const sorted = [...messageCounts].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const max = sorted[sorted.length - 1];

    console.log(`  Sampled ${this.conversationIds.length} conversations`);
    console.log(`  Message counts: p50=${p50}, p95=${p95}, max=${max}\n`);
  }

  /**
   * Define test queries
   */
  private getTestQueries(): QueryTest[] {
    return [
      {
        name: "Message History - Recent 20",
        description:
          "Fetch 20 most recent messages in a conversation (hot path)",
        sql: `
          SELECT m.id, m.content, m."createdAt", m."senderId"
          FROM messages m
          WHERE m."conversationId" = $1
          ORDER BY m."createdAt" DESC
          LIMIT 20
        `,
        params: [this.conversationIds[0]],
        expectation: {
          index_used: "idx_messages_conversation_created",
          no_sort: true,
          scan_type: "Index Scan",
        },
      },
      {
        name: "Message History - Deep Pagination (OFFSET 100)",
        description: "Fetch messages at offset 100 (tests OFFSET performance)",
        sql: `
          SELECT m.id, m.content, m."createdAt", m."senderId"
          FROM messages m
          WHERE m."conversationId" = $1
          ORDER BY m."createdAt" DESC
          LIMIT 20 OFFSET 100
        `,
        params: [this.conversationIds[0]],
        expectation: {
          index_used: "idx_messages_conversation_created",
          no_sort: true,
          scan_type: "Index Scan",
        },
      },
      {
        name: "Unread Messages Count",
        description: "Count unread messages per conversation (analytics query)",
        sql: `
          SELECT COUNT(*) as unread_count
          FROM messages m
          WHERE m."conversationId" = $1
            AND m."createdAt" > $2
        `,
        params: [
          this.conversationIds[1],
          new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        ],
        expectation: {
          index_used: "idx_messages_conversation_created",
          no_sort: false,
          scan_type: "Index Scan",
        },
      },
      {
        name: "Recent Messages Across Multiple Conversations",
        description:
          "Fetch 50 most recent messages from user's conversations (feed query)",
        sql: `
          SELECT m.id, m.content, m."createdAt", m."conversationId"
          FROM messages m
          WHERE m."conversationId" = ANY($1::text[])
          ORDER BY m."createdAt" DESC
          LIMIT 50
        `,
        params: [[this.conversationIds.slice(0, 10)]],
        expectation: {
          index_used: "idx_messages_conversation_created",
          no_sort: false, // May need separate index for multi-conversation queries
          scan_type: "Bitmap Index Scan",
        },
      },
      {
        name: "Message Range Query",
        description: "Fetch messages in a time range (historical query)",
        sql: `
          SELECT m.id, m."createdAt", m."senderId"
          FROM messages m
          WHERE m."conversationId" = $1
            AND m."createdAt" BETWEEN $2 AND $3
          ORDER BY m."createdAt" DESC
        `,
        params: [
          this.conversationIds[2],
          new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
          new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        ],
        expectation: {
          index_used: "idx_messages_conversation_created",
          no_sort: true,
          scan_type: "Index Scan",
        },
      },
      {
        name: "Latest Message Per Conversation",
        description: "Get last message for conversation list (preview query)",
        sql: `
          SELECT DISTINCT ON (m."conversationId")
            m.id, m.content, m."createdAt", m."conversationId"
          FROM messages m
          WHERE m."conversationId" = ANY($1::text[])
          ORDER BY m."conversationId", m."createdAt" DESC
        `,
        params: [[this.conversationIds.slice(0, 20)]],
        expectation: {
          index_used: "idx_messages_conversation_created",
          no_sort: false, // DISTINCT ON may require sort
          scan_type: "Index Scan",
        },
      },
    ];
  }

  /**
   * Execute EXPLAIN ANALYZE for a query
   */
  private async executeExplainAnalyze(
    query: string,
    params?: any[],
  ): Promise<any> {
    // Replace $1, $2 with actual values for EXPLAIN ANALYZE
    let explainQuery = query;
    if (params) {
      params.forEach((param, i) => {
        const paramValue = Array.isArray(param)
          ? `ARRAY[${param.map((p) => `'${p}'`).join(",")}]::text[]`
          : typeof param === "string"
            ? `'${param}'`
            : param instanceof Date
              ? `'${param.toISOString()}'::timestamp`
              : param;
        explainQuery = explainQuery.replace(
          new RegExp(`\\$${i + 1}`, "g"),
          String(paramValue),
        );
      });
    }

    const explainResult = await this.prisma.$queryRawUnsafe<any[]>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${explainQuery}`,
    );

    return explainResult[0]["QUERY PLAN"][0];
  }

  /**
   * Analyze query plan
   */
  private analyzePlan(
    plan: any,
    expectation: QueryTest["expectation"],
  ): PlanAnalysis {
    const analysis: PlanAnalysis = {
      uses_index: false,
      has_sort: false,
      scan_type: "Sequential Scan",
      total_cost: plan["Total Cost"] || 0,
      startup_cost: plan["Startup Cost"] || 0,
      rows_estimate: plan["Plan Rows"] || 0,
      actual_time_ms: plan["Actual Total Time"] || 0,
      warnings: [],
    };

    // Extract buffers if available
    if (plan["Shared Hit Blocks"] !== undefined) {
      analysis.buffers = {
        shared_hit: plan["Shared Hit Blocks"] || 0,
        shared_read: plan["Shared Read Blocks"] || 0,
        shared_dirtied: plan["Shared Dirtied Blocks"] || 0,
        shared_written: plan["Shared Written Blocks"] || 0,
      };
    }

    // Recursively check plan nodes
    const checkNode = (node: any): void => {
      if (!node) return;

      const nodeType = node["Node Type"] || "";

      // Check for index usage
      if (
        nodeType.includes("Index Scan") ||
        nodeType.includes("Index Only Scan")
      ) {
        analysis.uses_index = true;
        analysis.index_name = node["Index Name"];
        analysis.scan_type = nodeType;
      }

      // Check for Sort operations
      if (nodeType === "Sort") {
        analysis.has_sort = true;
        analysis.warnings.push(
          "SORT operation present - index not providing order",
        );
      }

      // Check for Sequential Scan
      if (nodeType === "Seq Scan") {
        analysis.warnings.push("Sequential scan detected - index not used");
      }

      // Check child plans
      if (node["Plans"]) {
        node["Plans"].forEach(checkNode);
      }
    };

    checkNode(plan.Plan);

    // Validate against expectations
    if (!analysis.uses_index && expectation.index_used) {
      analysis.warnings.push(
        `Expected index '${expectation.index_used}' not used`,
      );
    }

    if (analysis.has_sort && expectation.no_sort) {
      analysis.warnings.push(
        "Unexpected Sort operation - index should provide order",
      );
    }

    // Check buffer efficiency
    if (analysis.buffers) {
      const totalBuffers =
        analysis.buffers.shared_hit + analysis.buffers.shared_read;
      const hitRatio =
        totalBuffers > 0
          ? (analysis.buffers.shared_hit / totalBuffers) * 100
          : 0;

      if (hitRatio < 80 && totalBuffers > 100) {
        analysis.warnings.push(
          `Low buffer cache hit ratio: ${hitRatio.toFixed(1)}% (${analysis.buffers.shared_hit}/${totalBuffers})`,
        );
      }
    }

    return analysis;
  }

  /**
   * Execute performance tests
   */
  async runTests(): Promise<PerformanceReport> {
    console.log("╔═══════════════════════════════════════════════╗");
    console.log("║  DATABASE PERFORMANCE VALIDATION              ║");
    console.log("╚═══════════════════════════════════════════════╝\n");

    // Get dataset stats
    const [users, conversations, messages] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.conversation.count(),
      this.prisma.message.count(),
    ]);

    console.log(
      `Dataset: ${users.toLocaleString()} users, ${conversations.toLocaleString()} conversations, ${messages.toLocaleString()} messages\n`,
    );

    // Sample conversations
    await this.sampleConversations();

    // Define tests
    const testQueries = this.getTestQueries();
    const results: QueryResult[] = [];

    console.log(
      `[Testing] Running ${testQueries.length} query performance tests...\n`,
    );

    // Execute each test
    for (let i = 0; i < testQueries.length; i++) {
      const test = testQueries[i];
      console.log(`[${i + 1}/${testQueries.length}] ${test.name}`);

      try {
        const startTime = Date.now();
        const plan = await this.executeExplainAnalyze(test.sql, test.params);
        const executionTime = Date.now() - startTime;

        const analysis = this.analyzePlan(plan, test.expectation);

        // Determine verdict
        let verdict: "PASS" | "FAIL" | "WARN" = "PASS";
        const issues: string[] = [];

        if (!analysis.uses_index) {
          verdict = "FAIL";
          issues.push("Index not used");
        }

        if (analysis.has_sort && test.expectation.no_sort) {
          verdict = "FAIL";
          issues.push("Unexpected Sort operation");
        }

        if (analysis.warnings.length > 0) {
          if (verdict === "PASS") verdict = "WARN";
          issues.push(...analysis.warnings);
        }

        // Log result
        console.log(`  Execution: ${analysis.actual_time_ms.toFixed(2)}ms`);
        console.log(
          `  Index: ${analysis.uses_index ? `✓ ${analysis.index_name}` : "✗ Not used"}`,
        );
        console.log(`  Sort: ${analysis.has_sort ? "✗ Present" : "✓ Absent"}`);
        console.log(
          `  Verdict: ${verdict === "PASS" ? "✓ PASS" : verdict === "FAIL" ? "✗ FAIL" : "⚠ WARN"}`,
        );

        if (issues.length > 0) {
          console.log(`  Issues: ${issues.join(", ")}`);
        }

        console.log();

        results.push({
          test,
          execution_time_ms: executionTime,
          rows_returned: plan.Plan["Actual Rows"] || 0,
          plan,
          analysis,
          verdict,
          issues,
        });
      } catch (error: any) {
        console.error(`  ✗ ERROR: ${error.message}\n`);
        results.push({
          test,
          execution_time_ms: -1,
          rows_returned: 0,
          plan: null,
          analysis: {
            uses_index: false,
            has_sort: false,
            scan_type: "Error",
            total_cost: -1,
            startup_cost: -1,
            rows_estimate: -1,
            actual_time_ms: -1,
            warnings: [error.message],
          },
          verdict: "FAIL",
          issues: [error.message],
        });
      }
    }

    // Calculate latency percentiles
    const latencies = results
      .filter((r) => r.execution_time_ms > 0)
      .map((r) => r.analysis.actual_time_ms)
      .sort((a, b) => a - b);

    const latencyAnalysis = {
      p50_ms: latencies[Math.floor(latencies.length * 0.5)] || 0,
      p95_ms: latencies[Math.floor(latencies.length * 0.95)] || 0,
      p99_ms: latencies[Math.floor(latencies.length * 0.99)] || 0,
      max_ms: latencies[latencies.length - 1] || 0,
    };

    // Generate summary
    const passed = results.filter((r) => r.verdict === "PASS").length;
    const failed = results.filter((r) => r.verdict === "FAIL").length;
    const warnings = results.filter((r) => r.verdict === "WARN").length;

    const overallVerdict = failed > 0 ? "FAIL" : warnings > 0 ? "WARN" : "PASS";

    // Generate recommendations
    const recommendations: string[] = [];

    if (failed > 0) {
      recommendations.push(
        "❌ CRITICAL: Some queries not using indexes - review and create missing indexes",
      );
    }

    if (
      results.some((r) => r.analysis.has_sort && r.test.expectation.no_sort)
    ) {
      recommendations.push(
        "⚠ Sort operations detected - verify index column order matches ORDER BY clause",
      );
    }

    if (results.some((r) => r.issues.includes("Sequential scan detected"))) {
      recommendations.push(
        "⚠ Sequential scans detected - check index selectivity and statistics",
      );
    }

    if (latencyAnalysis.p95_ms > 100) {
      recommendations.push(
        `⚠ p95 latency high (${latencyAnalysis.p95_ms.toFixed(2)}ms) - consider covering indexes or query optimization`,
      );
    }

    const offsetQuery = results.find((r) => r.test.name.includes("OFFSET"));
    if (offsetQuery && offsetQuery.analysis.actual_time_ms > 50) {
      recommendations.push(
        "⚠ OFFSET pagination slow - implement keyset pagination for better performance",
      );
    }

    if (recommendations.length === 0) {
      recommendations.push("✓ All tests passed - indexes are effective");
      recommendations.push("✓ Query plans optimal - no Sort operations");
      recommendations.push("✓ Latency targets met - p95 < 100ms");
    }

    // Print summary
    console.log("\n╔═══════════════════════════════════════════════╗");
    console.log(`║  PERFORMANCE SUMMARY                          ║`);
    console.log("╚═══════════════════════════════════════════════╝\n");

    console.log(
      `Tests: ${passed} passed, ${failed} failed, ${warnings} warnings`,
    );
    console.log(`Overall: ${overallVerdict}\n`);

    console.log("Latency Analysis:");
    console.log(`  p50: ${latencyAnalysis.p50_ms.toFixed(2)}ms`);
    console.log(`  p95: ${latencyAnalysis.p95_ms.toFixed(2)}ms`);
    console.log(`  p99: ${latencyAnalysis.p99_ms.toFixed(2)}ms`);
    console.log(`  max: ${latencyAnalysis.max_ms.toFixed(2)}ms\n`);

    console.log("Recommendations:");
    recommendations.forEach((rec) => console.log(`  ${rec}`));
    console.log();

    return {
      generated_at: new Date().toISOString(),
      dataset_stats: {
        users,
        conversations,
        messages,
      },
      test_results: results,
      summary: {
        total_tests: results.length,
        passed,
        failed,
        warnings,
        overall_verdict: overallVerdict,
      },
      latency_analysis: latencyAnalysis,
      recommendations,
    };
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);

  let sampleSize = 100;
  let outputFile = "performance-report.json";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--sample-size" && args[i + 1]) {
      sampleSize = parseInt(args[i + 1], 10);
    } else if (args[i] === "--output" && args[i + 1]) {
      outputFile = args[i + 1];
    }
  }

  const validator = new PerformanceValidator(sampleSize);

  try {
    const report = await validator.runTests();

    // Write report
    fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
    console.log(`✓ Report written to: ${outputFile}\n`);

    // Exit code based on verdict
    process.exit(report.summary.overall_verdict === "FAIL" ? 1 : 0);
  } catch (error: any) {
    console.error("\n[FATAL ERROR]", error.message);
    process.exit(1);
  } finally {
    await validator.cleanup();
  }
}

if (require.main === module) {
  main();
}
