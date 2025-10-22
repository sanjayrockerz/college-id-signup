#!/usr/bin/env ts-node
/**
 * Index Performance Verifier
 *
 * ROLE: Database Performance Engineer
 * MISSION: Verify index efficacy on realistic data with EXPLAIN ANALYZE
 *
 * Executes parameterized EXPLAIN ANALYZE queries and captures plan deltas
 * to prove index adoption, Sort elimination, and latency improvements.
 *
 * Usage:
 *   ts-node verify-index-performance.ts --pre-optimization
 *   ts-node verify-index-performance.ts --post-optimization
 *   ts-node verify-index-performance.ts --compare pre_baseline.json post_baseline.json
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

interface QueryPlan {
  query_id: string;
  query_name: string;
  sql: string;
  parameters: Record<string, any>;
  plan: any;
  execution_time_ms: number;
  planning_time_ms: number;
  buffers: {
    shared_hit: number;
    shared_read: number;
    shared_dirtied: number;
    shared_written: number;
  };
  plan_analysis: {
    uses_index: boolean;
    index_name: string | null;
    has_sort_node: boolean;
    scan_type: string;
    rows_estimated: number;
    rows_actual: number;
    estimation_accuracy: number;
  };
}

interface BaselineReport {
  phase: "pre-optimization" | "post-optimization";
  captured_at: string;
  database_size_mb: number;
  queries: QueryPlan[];
  summary: {
    avg_execution_time_ms: number;
    p50_execution_time_ms: number;
    p95_execution_time_ms: number;
    total_sorts: number;
    index_adoption_rate: number;
  };
}

interface ComparisonReport {
  pre_baseline: string;
  post_baseline: string;
  compared_at: string;
  improvements: {
    query_id: string;
    query_name: string;
    pre_time_ms: number;
    post_time_ms: number;
    time_delta_ms: number;
    time_reduction_pct: number;
    sort_eliminated: boolean;
    index_adopted: boolean;
    status: "IMPROVED" | "DEGRADED" | "NO_CHANGE";
  }[];
  summary: {
    avg_improvement_pct: number;
    queries_improved: number;
    queries_degraded: number;
    queries_unchanged: number;
    p95_improvement_pct: number;
    sorts_eliminated: number;
    go_no_go: "GO" | "NO-GO";
    rationale: string;
  };
  mitigations: {
    query_id: string;
    issue: string;
    recommendation: string;
  }[];
}

class IndexPerformanceVerifier {
  private prisma: PrismaClient;
  private phase: "pre-optimization" | "post-optimization";

  constructor(phase: "pre-optimization" | "post-optimization") {
    this.prisma = new PrismaClient();
    this.phase = phase;

    console.log(`[IndexVerifier] Initialized for ${phase} phase`);
  }

  /**
   * Execute EXPLAIN ANALYZE suite
   */
  async captureBaseline(): Promise<BaselineReport> {
    console.log("\n=== CAPTURING QUERY BASELINES ===\n");

    const queries: QueryPlan[] = [];

    // Get sample IDs for parameterized queries
    const sampleUser = await this.prisma.user.findFirst();
    const sampleConversation = await this.prisma.conversation.findFirst({
      include: { _count: { select: { messages: true } } },
      orderBy: { messages: { _count: "desc" } },
    });

    if (!sampleUser || !sampleConversation) {
      throw new Error("Database empty - generate dataset first");
    }

    // Q1: Message history (P0 - highest impact)
    queries.push(
      await this.captureQuery(
        "Q1_message_history",
        "Message History (ORDER BY createdAt DESC LIMIT)",
        `
        SELECT id, content, type, "senderId", "createdAt"
        FROM messages
        WHERE "conversationId" = $1
        ORDER BY "createdAt" DESC
        LIMIT 50
      `,
        [sampleConversation.id],
      ),
    );

    // Q1b: Message history deep scroll (pagination)
    queries.push(
      await this.captureQuery(
        "Q1b_message_history_deep",
        "Message History Deep Scroll (LIMIT 100)",
        `
        SELECT id, content, type, "senderId", "createdAt"
        FROM messages
        WHERE "conversationId" = $1
        ORDER BY "createdAt" DESC
        LIMIT 100
      `,
        [sampleConversation.id],
      ),
    );

    // Q3: Conversation list (P1)
    queries.push(
      await this.captureQuery(
        "Q3_conversation_list",
        "Conversation List for User",
        `
        SELECT c.id, c.name, c.type, c."lastMessageAt", c."updatedAt"
        FROM conversations c
        JOIN conversation_users cu ON cu."conversationId" = c.id
        WHERE cu."userId" = $1 AND cu."isActive" = true
        ORDER BY c."updatedAt" DESC
        LIMIT 20
      `,
        [sampleUser.id],
      ),
    );

    // Q4: Unread message count (P1)
    queries.push(
      await this.captureQuery(
        "Q4_unread_count",
        "Unread Message Count",
        `
        SELECT COUNT(*) as unread_count
        FROM messages m
        LEFT JOIN message_reads mr ON mr."messageId" = m.id AND mr."userId" = $1
        WHERE m."conversationId" = $2
          AND mr.id IS NULL
      `,
        [sampleUser.id, sampleConversation.id],
      ),
    );

    // Q6: Presence lookup (P2)
    queries.push(
      await this.captureQuery(
        "Q6_presence_lookup",
        "Conversation Member Presence",
        `
        SELECT cu."userId", u.username, u."profileImageUrl"
        FROM conversation_users cu
        JOIN users u ON u.id = cu."userId"
        WHERE cu."conversationId" = $1 AND cu."isActive" = true
      `,
        [sampleConversation.id],
      ),
    );

    // Calculate database size
    const dbSize = await this.getDatabaseSizeMB();

    // Generate summary
    const executionTimes = queries
      .map((q) => q.execution_time_ms)
      .sort((a, b) => a - b);
    const p50 = this.percentile(executionTimes, 0.5);
    const p95 = this.percentile(executionTimes, 0.95);
    const avgTime =
      executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length;
    const totalSorts = queries.filter(
      (q) => q.plan_analysis.has_sort_node,
    ).length;
    const indexAdoptionRate =
      queries.filter((q) => q.plan_analysis.uses_index).length / queries.length;

    const report: BaselineReport = {
      phase: this.phase,
      captured_at: new Date().toISOString(),
      database_size_mb: dbSize,
      queries,
      summary: {
        avg_execution_time_ms: avgTime,
        p50_execution_time_ms: p50,
        p95_execution_time_ms: p95,
        total_sorts: totalSorts,
        index_adoption_rate: indexAdoptionRate,
      },
    };

    return report;
  }

  /**
   * Capture EXPLAIN ANALYZE for single query
   */
  private async captureQuery(
    queryId: string,
    queryName: string,
    sql: string,
    parameters: any[],
  ): Promise<QueryPlan> {
    console.log(`[Query] ${queryId}: ${queryName}`);

    // Execute EXPLAIN ANALYZE
    const explainSql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`;
    const result = await this.prisma.$queryRawUnsafe<any[]>(
      explainSql,
      ...parameters,
    );

    const planData = result[0]["QUERY PLAN"][0];
    const plan = planData.Plan;

    // Extract metrics
    const executionTime = planData["Execution Time"];
    const planningTime = planData["Planning Time"];

    // Extract buffer stats
    const buffers = {
      shared_hit: plan["Shared Hit Blocks"] || 0,
      shared_read: plan["Shared Read Blocks"] || 0,
      shared_dirtied: plan["Shared Dirtied Blocks"] || 0,
      shared_written: plan["Shared Written Blocks"] || 0,
    };

    // Analyze plan structure
    const analysis = this.analyzePlan(plan);

    console.log(`  Execution: ${executionTime.toFixed(2)}ms`);
    console.log(`  Index: ${analysis.uses_index ? analysis.index_name : "NO"}`);
    console.log(`  Sort: ${analysis.has_sort_node ? "YES ⚠️" : "NO ✓"}`);
    console.log(
      `  Buffers: ${buffers.shared_hit} hit / ${buffers.shared_read} read`,
    );

    return {
      query_id: queryId,
      query_name: queryName,
      sql: sql.trim(),
      parameters: this.serializeParameters(parameters),
      plan: planData,
      execution_time_ms: executionTime,
      planning_time_ms: planningTime,
      buffers,
      plan_analysis: analysis,
    };
  }

  /**
   * Analyze query plan structure
   */
  private analyzePlan(plan: any): QueryPlan["plan_analysis"] {
    let usesIndex = false;
    let indexName: string | null = null;
    let hasSortNode = false;
    let scanType = "Unknown";
    let rowsEstimated = 0;
    let rowsActual = 0;

    const traverse = (node: any) => {
      if (!node) return;

      // Check for index usage
      if (node["Node Type"]?.includes("Index") || node["Index Name"]) {
        usesIndex = true;
        indexName = node["Index Name"] || null;
        scanType = node["Node Type"];
      }

      // Check for Sort node
      if (node["Node Type"] === "Sort") {
        hasSortNode = true;
      }

      // Capture row stats from top node
      if (!rowsEstimated) {
        rowsEstimated = node["Plan Rows"] || 0;
        rowsActual = node["Actual Rows"] || 0;
      }

      // Recursively check child plans
      if (node.Plans) {
        node.Plans.forEach(traverse);
      }
    };

    traverse(plan);

    const estimationAccuracy =
      rowsEstimated > 0
        ? Math.min(rowsActual / rowsEstimated, rowsEstimated / rowsActual)
        : 1;

    return {
      uses_index: usesIndex,
      index_name: indexName,
      has_sort_node: hasSortNode,
      scan_type: scanType,
      rows_estimated: rowsEstimated,
      rows_actual: rowsActual,
      estimation_accuracy: estimationAccuracy,
    };
  }

  /**
   * Compare pre and post baselines
   */
  static async compareBaselines(
    preBaselinePath: string,
    postBaselinePath: string,
  ): Promise<ComparisonReport> {
    console.log("\n=== COMPARING BASELINES ===\n");

    const preBaseline: BaselineReport = JSON.parse(
      fs.readFileSync(preBaselinePath, "utf-8"),
    );
    const postBaseline: BaselineReport = JSON.parse(
      fs.readFileSync(postBaselinePath, "utf-8"),
    );

    const improvements: ComparisonReport["improvements"] = [];
    const mitigations: ComparisonReport["mitigations"] = [];

    for (const preQuery of preBaseline.queries) {
      const postQuery = postBaseline.queries.find(
        (q) => q.query_id === preQuery.query_id,
      );

      if (!postQuery) {
        console.log(
          `⚠️  Query ${preQuery.query_id} not found in post-optimization baseline`,
        );
        continue;
      }

      const timeDelta =
        postQuery.execution_time_ms - preQuery.execution_time_ms;
      const timeReduction = -timeDelta / preQuery.execution_time_ms;
      const sortEliminated =
        preQuery.plan_analysis.has_sort_node &&
        !postQuery.plan_analysis.has_sort_node;
      const indexAdopted =
        !preQuery.plan_analysis.uses_index &&
        postQuery.plan_analysis.uses_index;

      let status: "IMPROVED" | "DEGRADED" | "NO_CHANGE";
      if (timeReduction > 0.1) {
        status = "IMPROVED";
      } else if (timeReduction < -0.1) {
        status = "DEGRADED";
      } else {
        status = "NO_CHANGE";
      }

      improvements.push({
        query_id: preQuery.query_id,
        query_name: preQuery.query_name,
        pre_time_ms: preQuery.execution_time_ms,
        post_time_ms: postQuery.execution_time_ms,
        time_delta_ms: timeDelta,
        time_reduction_pct: timeReduction * 100,
        sort_eliminated: sortEliminated,
        index_adopted: indexAdopted,
        status,
      });

      console.log(`[${preQuery.query_id}] ${preQuery.query_name}`);
      console.log(`  Pre:  ${preQuery.execution_time_ms.toFixed(2)}ms`);
      console.log(`  Post: ${postQuery.execution_time_ms.toFixed(2)}ms`);
      console.log(
        `  Δ:    ${timeDelta > 0 ? "+" : ""}${timeDelta.toFixed(2)}ms (${(timeReduction * 100).toFixed(1)}%)`,
      );
      console.log(
        `  Sort: ${sortEliminated ? "ELIMINATED ✓" : preQuery.plan_analysis.has_sort_node ? "STILL PRESENT ⚠️" : "N/A"}`,
      );
      console.log(
        `  Index: ${indexAdopted ? "ADOPTED ✓" : postQuery.plan_analysis.uses_index ? "USED" : "NO"}`,
      );

      // Identify issues needing mitigation
      if (status === "DEGRADED") {
        mitigations.push({
          query_id: preQuery.query_id,
          issue: `Performance degraded by ${(-timeReduction * 100).toFixed(1)}%`,
          recommendation:
            "Review index maintenance overhead vs read benefit. Consider partial index.",
        });
      }

      if (
        postQuery.plan_analysis.has_sort_node &&
        preQuery.query_name.includes("ORDER BY")
      ) {
        mitigations.push({
          query_id: preQuery.query_id,
          issue: "Sort node still present despite index",
          recommendation:
            "Verify composite index covers ORDER BY column. Check index direction (ASC/DESC).",
        });
      }

      if (postQuery.buffers.shared_read > postQuery.buffers.shared_hit * 0.5) {
        mitigations.push({
          query_id: preQuery.query_id,
          issue: `High heap reads (${postQuery.buffers.shared_read} blocks)`,
          recommendation:
            "Consider covering index with INCLUDE clause to avoid heap lookups.",
        });
      }

      console.log("");
    }

    // Generate summary
    const avgImprovement =
      improvements.reduce((sum, i) => sum + i.time_reduction_pct, 0) /
      improvements.length;
    const p95Improvement =
      ((preBaseline.summary.p95_execution_time_ms -
        postBaseline.summary.p95_execution_time_ms) /
        preBaseline.summary.p95_execution_time_ms) *
      100;

    const queriesImproved = improvements.filter(
      (i) => i.status === "IMPROVED",
    ).length;
    const queriesDegraded = improvements.filter(
      (i) => i.status === "DEGRADED",
    ).length;
    const queriesUnchanged = improvements.filter(
      (i) => i.status === "NO_CHANGE",
    ).length;
    const sortsEliminated = improvements.filter(
      (i) => i.sort_eliminated,
    ).length;

    // GO/NO-GO decision
    let goNoGo: "GO" | "NO-GO" = "GO";
    let rationale = "";

    if (avgImprovement < 30) {
      goNoGo = "NO-GO";
      rationale = `Average improvement ${avgImprovement.toFixed(1)}% is below 30% target. Index design needs revision.`;
    } else if (queriesDegraded > 1) {
      goNoGo = "NO-GO";
      rationale = `${queriesDegraded} queries degraded. Review write amplification and index selectivity.`;
    } else if (sortsEliminated < improvements.length * 0.6) {
      goNoGo = "NO-GO";
      rationale = `Only ${sortsEliminated}/${improvements.length} sorts eliminated. Index may not be used correctly.`;
    } else {
      rationale = `Index adoption successful. Average improvement ${avgImprovement.toFixed(1)}%, p95 improvement ${p95Improvement.toFixed(1)}%. Authorized to proceed to pooling/caching.`;
    }

    const report: ComparisonReport = {
      pre_baseline: preBaselinePath,
      post_baseline: postBaselinePath,
      compared_at: new Date().toISOString(),
      improvements,
      summary: {
        avg_improvement_pct: avgImprovement,
        queries_improved: queriesImproved,
        queries_degraded: queriesDegraded,
        queries_unchanged: queriesUnchanged,
        p95_improvement_pct: p95Improvement,
        sorts_eliminated: sortsEliminated,
        go_no_go: goNoGo,
        rationale,
      },
      mitigations,
    };

    return report;
  }

  /**
   * Helper: Get database size
   */
  private async getDatabaseSizeMB(): Promise<number> {
    const result = await this.prisma.$queryRaw<any[]>`
      SELECT pg_database_size(current_database()) / 1024 / 1024 as size_mb
    `;
    return result[0]?.size_mb || 0;
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
   * Helper: Serialize parameters for report
   */
  private serializeParameters(params: any[]): Record<string, any> {
    const result: Record<string, any> = {};
    params.forEach((param, idx) => {
      result[`$${idx + 1}`] =
        typeof param === "string" ? `<id:${param.substring(0, 8)}...>` : param;
    });
    return result;
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--compare")) {
    const preIndex = args.indexOf("--compare") + 1;
    const preBaseline = args[preIndex];
    const postBaseline = args[preIndex + 1];

    if (!preBaseline || !postBaseline) {
      console.error(
        "Usage: ts-node verify-index-performance.ts --compare <pre_baseline.json> <post_baseline.json>",
      );
      process.exit(1);
    }

    const report = await IndexPerformanceVerifier.compareBaselines(
      preBaseline,
      postBaseline,
    );

    // Save comparison report
    const reportPath = `docs/database/baselines/comparison-${Date.now()}.json`;
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log("\n=== COMPARISON SUMMARY ===");
    console.log(
      `Average improvement: ${report.summary.avg_improvement_pct.toFixed(1)}%`,
    );
    console.log(
      `P95 improvement: ${report.summary.p95_improvement_pct.toFixed(1)}%`,
    );
    console.log(`Sorts eliminated: ${report.summary.sorts_eliminated}`);
    console.log(`Queries improved: ${report.summary.queries_improved}`);
    console.log(`Queries degraded: ${report.summary.queries_degraded}`);
    console.log(`\nDecision: ${report.summary.go_no_go}`);
    console.log(`Rationale: ${report.summary.rationale}`);

    if (report.mitigations.length > 0) {
      console.log(
        `\n⚠️  ${report.mitigations.length} mitigation(s) recommended:`,
      );
      report.mitigations.forEach((m) => {
        console.log(`  [${m.query_id}] ${m.issue}`);
        console.log(`    → ${m.recommendation}`);
      });
    }

    console.log(`\nReport saved: ${reportPath}`);

    if (report.summary.go_no_go === "NO-GO") {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } else {
    // Capture baseline
    const phase = args.includes("--post-optimization")
      ? "post-optimization"
      : "pre-optimization";
    const verifier = new IndexPerformanceVerifier(phase);

    try {
      const report = await verifier.captureBaseline();

      // Save baseline
      const reportPath = `docs/database/baselines/${phase}/baseline-${Date.now()}.json`;
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

      console.log("\n=== BASELINE SUMMARY ===");
      console.log(`Phase: ${report.phase}`);
      console.log(`Queries captured: ${report.queries.length}`);
      console.log(
        `Average execution: ${report.summary.avg_execution_time_ms.toFixed(2)}ms`,
      );
      console.log(`P50: ${report.summary.p50_execution_time_ms.toFixed(2)}ms`);
      console.log(`P95: ${report.summary.p95_execution_time_ms.toFixed(2)}ms`);
      console.log(`Sorts present: ${report.summary.total_sorts}`);
      console.log(
        `Index adoption: ${(report.summary.index_adoption_rate * 100).toFixed(0)}%`,
      );
      console.log(`\nReport saved: ${reportPath}`);

      process.exit(0);
    } catch (error) {
      console.error("\n=== ERROR ===");
      console.error(error);
      process.exit(1);
    } finally {
      await verifier.cleanup();
    }
  }
}

if (require.main === module) {
  main();
}
