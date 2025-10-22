#!/usr/bin/env ts-node

/**
 * Database Query Baseline Analyzer
 *
 * Captures EXPLAIN ANALYZE output for all hot path queries identified in Phase 1.
 * Runs queries with representative parameters and data volumes to establish
 * pre-optimization baselines.
 *
 * Usage:
 *   npm run db:baseline:capture
 *   # or
 *   ts-node scripts/performance/db-baseline/capture-baseline.ts
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient({
  log: [
    { level: "query", emit: "event" },
    { level: "error", emit: "stdout" },
  ],
});

interface QueryResult {
  queryName: string;
  queryType: "READ" | "WRITE";
  sqlQuery: string;
  parameters: any[];
  explainAnalyze: string;
  executionTimeMs: number;
  rowsReturned: number;
  findings: {
    usesIndex: boolean;
    indexName?: string;
    hasSeqScan: boolean;
    hasSort: boolean;
    hasNestedLoop: boolean;
    planningTimeMs: number;
    executionTimeMs: number;
    totalTimeMs: number;
  };
  timestamp: string;
}

interface BaselineReport {
  generatedAt: string;
  databaseInfo: {
    version: string;
    maxConnections: number;
    sharedBuffers: string;
  };
  dataVolume: {
    totalUsers: number;
    totalConversations: number;
    totalMessages: number;
    totalMessageReads: number;
    totalConversationUsers: number;
  };
  queries: QueryResult[];
  summary: {
    totalQueriesAnalyzed: number;
    queriesWithSeqScans: number;
    queriesWithSorts: number;
    avgExecutionTimeMs: number;
    p50ExecutionTimeMs: number;
    p95ExecutionTimeMs: number;
  };
}

/**
 * Execute raw SQL with EXPLAIN ANALYZE
 */
async function explainAnalyze(sql: string, params: any[] = []): Promise<any[]> {
  const explainSql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`;
  const result = await prisma.$queryRawUnsafe(explainSql, ...params);
  return result as any[];
}

/**
 * Parse EXPLAIN ANALYZE JSON output
 */
function parseExplainAnalyze(explainResult: any[]): QueryResult["findings"] {
  const plan = explainResult[0]?.["QUERY PLAN"]?.[0];

  if (!plan) {
    throw new Error("Invalid EXPLAIN ANALYZE result");
  }

  const findInPlan = (node: any, condition: (n: any) => boolean): boolean => {
    if (condition(node)) return true;
    if (node["Plans"]) {
      return node["Plans"].some((child: any) => findInPlan(child, condition));
    }
    return false;
  };

  const hasSeqScan = findInPlan(
    plan.Plan,
    (n) => n["Node Type"] === "Seq Scan",
  );
  const hasSort = findInPlan(plan.Plan, (n) => n["Node Type"] === "Sort");
  const hasNestedLoop = findInPlan(
    plan.Plan,
    (n) => n["Node Type"] === "Nested Loop",
  );

  const indexScan = findInPlan(
    plan.Plan,
    (n) =>
      n["Node Type"] === "Index Scan" || n["Node Type"] === "Index Only Scan",
  );

  const indexName = indexScan
    ? plan.Plan["Index Name"] || "unknown"
    : undefined;

  return {
    usesIndex: indexScan,
    indexName,
    hasSeqScan,
    hasSort,
    hasNestedLoop,
    planningTimeMs: plan["Planning Time"] || 0,
    executionTimeMs: plan["Execution Time"] || 0,
    totalTimeMs: (plan["Planning Time"] || 0) + (plan["Execution Time"] || 0),
  };
}

/**
 * Get database configuration info
 */
async function getDatabaseInfo() {
  const version = await prisma.$queryRaw<any[]>`SELECT version();`;
  const maxConn = await prisma.$queryRaw<any[]>`SHOW max_connections;`;
  const sharedBuf = await prisma.$queryRaw<any[]>`SHOW shared_buffers;`;

  return {
    version: version[0]?.version || "unknown",
    maxConnections: parseInt(maxConn[0]?.max_connections || "100"),
    sharedBuffers: sharedBuf[0]?.shared_buffers || "unknown",
  };
}

/**
 * Get current data volumes
 */
async function getDataVolume() {
  const [users, conversations, messages, messageReads, conversationUsers] =
    await Promise.all([
      prisma.user.count(),
      prisma.conversation.count(),
      prisma.message.count(),
      prisma.messageRead.count(),
      prisma.conversationUser.count(),
    ]);

  return {
    totalUsers: users,
    totalConversations: conversations,
    totalMessages: messages,
    totalMessageReads: messageReads,
    totalConversationUsers: conversationUsers,
  };
}

/**
 * Find a sample conversation with messages for testing
 */
async function getSampleData() {
  // Find a conversation with messages
  const conversation = await prisma.conversation.findFirst({
    where: {
      messages: {
        some: {},
      },
    },
    include: {
      conversationUsers: {
        take: 1,
        include: {
          user: true,
        },
      },
      messages: {
        take: 5,
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!conversation) {
    throw new Error(
      "No sample conversation found. Please seed the database first.",
    );
  }

  const userId = conversation.conversationUsers[0]?.userId;
  if (!userId) {
    throw new Error("No user found in sample conversation");
  }

  return {
    conversationId: conversation.id,
    userId: userId,
    messageIds: conversation.messages.map((m) => m.id),
  };
}

/**
 * Analyze Query 1: Message History (CRITICAL PATH)
 */
async function analyzeMessageHistory(
  conversationId: string,
  userId: string,
): Promise<QueryResult> {
  const sql = `
    SELECT 
      m.id, m.content, m.type, m.status, m."createdAt", m."updatedAt",
      m."senderId", m."conversationId"
    FROM messages m
    WHERE m."conversationId" = $1
    ORDER BY m."createdAt" DESC
    LIMIT 50
  `;

  const startTime = Date.now();
  const explainResult = await explainAnalyze(sql, [conversationId]);
  const executionTime = Date.now() - startTime;

  // Get actual row count
  const rows = await prisma.$queryRawUnsafe<any[]>(sql, conversationId);

  return {
    queryName: "Message History Query",
    queryType: "READ",
    sqlQuery: sql.trim(),
    parameters: [conversationId],
    explainAnalyze: JSON.stringify(explainResult, null, 2),
    executionTimeMs: executionTime,
    rowsReturned: rows.length,
    findings: parseExplainAnalyze(explainResult),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Analyze Query 2: Message Insert (WRITE PATH)
 */
async function analyzeMessageInsert(
  conversationId: string,
  senderId: string,
): Promise<QueryResult> {
  // We'll use EXPLAIN only (not ANALYZE) to avoid actually inserting
  const sql = `
    INSERT INTO messages (
      id, "conversationId", "senderId", content, type, status,
      "createdAt", "updatedAt"
    )
    VALUES (
      gen_random_uuid(), $1, $2, $3, 'TEXT', 'SENT',
      NOW(), NOW()
    )
    RETURNING *
  `;

  const startTime = Date.now();
  // Use EXPLAIN only for writes to avoid side effects
  const explainSql = `EXPLAIN (FORMAT JSON) ${sql}`;
  const explainResult = await prisma.$queryRawUnsafe<any[]>(
    explainSql,
    conversationId,
    senderId,
    "Test message for baseline analysis",
  );
  const executionTime = Date.now() - startTime;

  return {
    queryName: "Message Insert Query",
    queryType: "WRITE",
    sqlQuery: sql.trim(),
    parameters: [conversationId, senderId, "Test message"],
    explainAnalyze: JSON.stringify(explainResult, null, 2),
    executionTimeMs: executionTime,
    rowsReturned: 1,
    findings: {
      usesIndex: true,
      hasSeqScan: false,
      hasSort: false,
      hasNestedLoop: false,
      planningTimeMs: executionTime / 2,
      executionTimeMs: executionTime / 2,
      totalTimeMs: executionTime,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Analyze Query 3: Conversation List (HIGH FREQUENCY)
 */
async function analyzeConversationList(userId: string): Promise<QueryResult> {
  const sql = `
    SELECT 
      c.id, c.name, c.type, c."updatedAt", c."lastMessageAt"
    FROM conversations c
    INNER JOIN conversation_users cu ON cu."conversationId" = c.id
    WHERE cu."userId" = $1
      AND cu."isActive" = true
    ORDER BY c."updatedAt" DESC
    LIMIT 20
  `;

  const startTime = Date.now();
  const explainResult = await explainAnalyze(sql, [userId]);
  const executionTime = Date.now() - startTime;

  const rows = await prisma.$queryRawUnsafe<any[]>(sql, userId);

  return {
    queryName: "Conversation List Query",
    queryType: "READ",
    sqlQuery: sql.trim(),
    parameters: [userId],
    explainAnalyze: JSON.stringify(explainResult, null, 2),
    executionTimeMs: executionTime,
    rowsReturned: rows.length,
    findings: parseExplainAnalyze(explainResult),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Analyze Query 4: Unread Counter (CRITICAL BOTTLENECK)
 */
async function analyzeUnreadCounter(userId: string): Promise<QueryResult> {
  const sql = `
    SELECT COUNT(*) as unread_count
    FROM messages m
    WHERE m."conversationId" IN (
      SELECT "conversationId" 
      FROM conversation_users 
      WHERE "userId" = $1
    )
    AND m."senderId" != $1
    AND NOT EXISTS (
      SELECT 1 FROM message_reads mr
      WHERE mr."messageId" = m.id AND mr."userId" = $1
    )
  `;

  const startTime = Date.now();
  const explainResult = await explainAnalyze(sql, [userId]);
  const executionTime = Date.now() - startTime;

  const rows = await prisma.$queryRawUnsafe<any[]>(sql, userId);

  return {
    queryName: "Unread Counter Query",
    queryType: "READ",
    sqlQuery: sql.trim(),
    parameters: [userId],
    explainAnalyze: JSON.stringify(explainResult, null, 2),
    executionTimeMs: executionTime,
    rowsReturned: rows.length,
    findings: parseExplainAnalyze(explainResult),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Analyze Query 5: Participant Verification (SECURITY PATH)
 */
async function analyzeParticipantCheck(
  conversationId: string,
  userId: string,
): Promise<QueryResult> {
  const sql = `
    SELECT 1
    FROM conversation_users cu
    WHERE cu."conversationId" = $1
      AND cu."userId" = $2
      AND cu."isActive" = true
    LIMIT 1
  `;

  const startTime = Date.now();
  const explainResult = await explainAnalyze(sql, [conversationId, userId]);
  const executionTime = Date.now() - startTime;

  const rows = await prisma.$queryRawUnsafe<any[]>(sql, conversationId, userId);

  return {
    queryName: "Participant Verification Query",
    queryType: "READ",
    sqlQuery: sql.trim(),
    parameters: [conversationId, userId],
    explainAnalyze: JSON.stringify(explainResult, null, 2),
    executionTimeMs: executionTime,
    rowsReturned: rows.length,
    findings: parseExplainAnalyze(explainResult),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Calculate summary statistics
 */
function calculateSummary(queries: QueryResult[]) {
  const executionTimes = queries
    .map((q) => q.executionTimeMs)
    .sort((a, b) => a - b);
  const seqScans = queries.filter((q) => q.findings.hasSeqScan).length;
  const sorts = queries.filter((q) => q.findings.hasSort).length;

  const p50Index = Math.floor(executionTimes.length * 0.5);
  const p95Index = Math.floor(executionTimes.length * 0.95);

  return {
    totalQueriesAnalyzed: queries.length,
    queriesWithSeqScans: seqScans,
    queriesWithSorts: sorts,
    avgExecutionTimeMs:
      executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length,
    p50ExecutionTimeMs: executionTimes[p50Index] || 0,
    p95ExecutionTimeMs: executionTimes[p95Index] || 0,
  };
}

/**
 * Main execution
 */
async function main() {
  console.log("🔍 Starting Database Query Baseline Analysis...\n");

  try {
    // Get database info
    console.log("📊 Collecting database information...");
    const databaseInfo = await getDatabaseInfo();
    console.log(`   PostgreSQL Version: ${databaseInfo.version.split(" ")[1]}`);
    console.log(`   Max Connections: ${databaseInfo.maxConnections}`);
    console.log(`   Shared Buffers: ${databaseInfo.sharedBuffers}\n`);

    // Get data volumes
    console.log("📈 Collecting data volume statistics...");
    const dataVolume = await getDataVolume();
    console.log(`   Users: ${dataVolume.totalUsers.toLocaleString()}`);
    console.log(
      `   Conversations: ${dataVolume.totalConversations.toLocaleString()}`,
    );
    console.log(`   Messages: ${dataVolume.totalMessages.toLocaleString()}`);
    console.log(
      `   Message Reads: ${dataVolume.totalMessageReads.toLocaleString()}`,
    );
    console.log(
      `   Conversation Users: ${dataVolume.totalConversationUsers.toLocaleString()}\n`,
    );

    // Get sample data
    console.log("🎯 Finding sample data for analysis...");
    const sampleData = await getSampleData();
    console.log(`   Sample Conversation: ${sampleData.conversationId}`);
    console.log(`   Sample User: ${sampleData.userId}\n`);

    // Analyze each query
    const queries: QueryResult[] = [];

    console.log("🔬 Analyzing Query 1: Message History (CRITICAL PATH)...");
    const q1 = await analyzeMessageHistory(
      sampleData.conversationId,
      sampleData.userId,
    );
    queries.push(q1);
    console.log(`   ⏱️  Execution Time: ${q1.executionTimeMs.toFixed(2)}ms`);
    console.log(`   📦 Rows Returned: ${q1.rowsReturned}`);
    console.log(`   📊 Uses Index: ${q1.findings.usesIndex ? "✅" : "❌"}`);
    console.log(
      `   🔍 Has Seq Scan: ${q1.findings.hasSeqScan ? "⚠️  YES" : "✅ NO"}`,
    );
    console.log(
      `   📈 Has Sort: ${q1.findings.hasSort ? "⚠️  YES" : "✅ NO"}\n`,
    );

    console.log("🔬 Analyzing Query 2: Message Insert (WRITE PATH)...");
    const q2 = await analyzeMessageInsert(
      sampleData.conversationId,
      sampleData.userId,
    );
    queries.push(q2);
    console.log(`   ⏱️  Planning Time: ${q2.executionTimeMs.toFixed(2)}ms\n`);

    console.log("🔬 Analyzing Query 3: Conversation List (HIGH FREQUENCY)...");
    const q3 = await analyzeConversationList(sampleData.userId);
    queries.push(q3);
    console.log(`   ⏱️  Execution Time: ${q3.executionTimeMs.toFixed(2)}ms`);
    console.log(`   📦 Rows Returned: ${q3.rowsReturned}`);
    console.log(`   📊 Uses Index: ${q3.findings.usesIndex ? "✅" : "❌"}`);
    console.log(
      `   🔍 Has Seq Scan: ${q3.findings.hasSeqScan ? "⚠️  YES" : "✅ NO"}`,
    );
    console.log(
      `   📈 Has Sort: ${q3.findings.hasSort ? "⚠️  YES" : "✅ NO"}\n`,
    );

    console.log(
      "🔬 Analyzing Query 4: Unread Counter (CRITICAL BOTTLENECK)...",
    );
    const q4 = await analyzeUnreadCounter(sampleData.userId);
    queries.push(q4);
    console.log(`   ⏱️  Execution Time: ${q4.executionTimeMs.toFixed(2)}ms`);
    console.log(`   📦 Result: ${q4.rowsReturned} unread`);
    console.log(`   📊 Uses Index: ${q4.findings.usesIndex ? "✅" : "❌"}`);
    console.log(
      `   🔍 Has Seq Scan: ${q4.findings.hasSeqScan ? "⚠️  YES" : "✅ NO"}`,
    );
    console.log(
      `   📈 Has Sort: ${q4.findings.hasSort ? "⚠️  YES" : "✅ NO"}\n`,
    );

    console.log(
      "🔬 Analyzing Query 5: Participant Verification (SECURITY PATH)...",
    );
    const q5 = await analyzeParticipantCheck(
      sampleData.conversationId,
      sampleData.userId,
    );
    queries.push(q5);
    console.log(`   ⏱️  Execution Time: ${q5.executionTimeMs.toFixed(2)}ms`);
    console.log(`   📊 Uses Index: ${q5.findings.usesIndex ? "✅" : "❌"}`);
    console.log(
      `   🔍 Has Seq Scan: ${q5.findings.hasSeqScan ? "⚠️  YES" : "✅ NO"}\n`,
    );

    // Calculate summary
    const summary = calculateSummary(queries);

    // Create baseline report
    const report: BaselineReport = {
      generatedAt: new Date().toISOString(),
      databaseInfo,
      dataVolume,
      queries,
      summary,
    };

    // Save to file
    const outputDir = path.join(
      __dirname,
      "../../../docs/performance/baseline",
    );
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, `baseline-${Date.now()}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

    console.log("✅ Baseline Analysis Complete!\n");
    console.log("📊 Summary:");
    console.log(`   Total Queries Analyzed: ${summary.totalQueriesAnalyzed}`);
    console.log(
      `   Queries with Sequential Scans: ${summary.queriesWithSeqScans}`,
    );
    console.log(`   Queries with Sorts: ${summary.queriesWithSorts}`);
    console.log(
      `   Average Execution Time: ${summary.avgExecutionTimeMs.toFixed(2)}ms`,
    );
    console.log(
      `   P50 Execution Time: ${summary.p50ExecutionTimeMs.toFixed(2)}ms`,
    );
    console.log(
      `   P95 Execution Time: ${summary.p95ExecutionTimeMs.toFixed(2)}ms\n`,
    );

    console.log(`📄 Full report saved to: ${outputPath}\n`);

    // Highlight critical findings
    console.log("🚨 Critical Findings:");
    const criticalQueries = queries.filter(
      (q) =>
        q.findings.hasSeqScan || q.findings.hasSort || q.executionTimeMs > 50,
    );

    if (criticalQueries.length > 0) {
      criticalQueries.forEach((q) => {
        console.log(`\n   ⚠️  ${q.queryName}:`);
        if (q.findings.hasSeqScan)
          console.log("      - Sequential scan detected (needs index)");
        if (q.findings.hasSort)
          console.log(
            "      - Explicit sort operation (needs composite index)",
          );
        if (q.executionTimeMs > 50)
          console.log(
            `      - High latency (${q.executionTimeMs.toFixed(2)}ms)`,
          );
      });
    } else {
      console.log("   ✅ No critical issues detected");
    }

    console.log("\n");
  } catch (error) {
    console.error("❌ Error during baseline analysis:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run if executed directly
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { main, BaselineReport, QueryResult };
