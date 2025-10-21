import { PrismaClient } from '@prisma/client';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

interface QueryDefinition {
  name: string;
  sql: string;
  parameters: unknown[];
}

interface QueryMetrics {
  planningTimeMs: number;
  executionTimeMs: number;
  totalRows: number;
  scanTypes: string[];
  indexNames: string[];
}

interface QueryReportEntry {
  name: string;
  query: string;
  metrics: QueryMetrics | null;
  warnings: string[];
}

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required for query analysis.');
  process.exit(1);
}

const prisma = new PrismaClient();

const QUERY_DEFINITIONS: QueryDefinition[] = [
  {
    name: 'Message history pagination',
    sql: `
      SELECT "id", "senderId", "content", "createdAt"
      FROM "messages"
      WHERE "conversationId" = $1
      ORDER BY "createdAt" DESC
      LIMIT $2 OFFSET $3
    `,
    parameters: ['8f7a0c83-dad5-4f02-92a9-55078fef9f31', 50, 0],
  },
  {
    name: 'Conversation list for user',
    sql: `
      SELECT c."id", c."name", c."updatedAt", cu."lastReadAt"
      FROM "conversations" c
      INNER JOIN "conversation_users" cu ON cu."conversationId" = c."id"
      WHERE cu."userId" = $1 AND cu."isActive" = true
      ORDER BY c."updatedAt" DESC
      LIMIT $2 OFFSET $3
    `,
    parameters: ['5b12e375-59a5-4e65-a2d2-3a4edc0d2b5c', 25, 0],
  },
  {
    name: 'Message insert baseline',
    sql: `
      INSERT INTO "messages" ("id", "conversationId", "senderId", "content", "type", "status", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), $1, $2, $3, 'TEXT', 'SENT', NOW(), NOW())
      RETURNING "id"
    `,
    parameters: ['8f7a0c83-dad5-4f02-92a9-55078fef9f31', '5b12e375-59a5-4e65-a2d2-3a4edc0d2b5c', 'Performance test message'],
  },
];

function formatTimestampForFilename(input: Date): string {
  return input.toISOString().replace(/[:]/g, '-');
}

function formatTimestamp(input: Date): string {
  return input.toISOString();
}

function escapeLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Invalid numeric parameter for raw SQL value.');
    }
    return value.toString();
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  if (value instanceof Date) {
    return `'${escapeLiteral(value.toISOString())}'`;
  }
  return `'${escapeLiteral(String(value))}'`;
}

function formatSqlWithParams(sql: string, params: unknown[]): string {
  let formatted = sql.trim();
  const reversed = [...params.entries()].reverse();
  reversed.forEach(([index, param]) => {
    const placeholder = new RegExp(`\\$${index + 1}(?!\\d)`, 'g');
    formatted = formatted.replace(placeholder, formatValue(param));
  });
  if (formatted.endsWith(';')) {
    formatted = formatted.slice(0, -1);
  }
  return formatted;
}

type PlanNode = { [key: string]: any };

interface PlanStats {
  scanTypes: Set<string>;
  indexNames: Set<string>;
  totalRows: number;
}

function traversePlan(node: PlanNode, stats: PlanStats): void {
  if (!node || typeof node !== 'object') {
    return;
  }
  const nodeType = typeof node['Node Type'] === 'string' ? node['Node Type'] : undefined;
  if (nodeType) {
    stats.scanTypes.add(nodeType);
  }
  const indexName = typeof node['Index Name'] === 'string' ? node['Index Name'] : undefined;
  if (indexName) {
    stats.indexNames.add(indexName);
  }
  const actualRows = typeof node['Actual Rows'] === 'number' ? node['Actual Rows'] : undefined;
  if (typeof actualRows === 'number') {
    stats.totalRows += actualRows;
  }
  const subPlans = Array.isArray(node['Plans']) ? node['Plans'] : [];
  subPlans.forEach((child) => traversePlan(child, stats));
}

function parseExplainResult(raw: unknown): QueryMetrics {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('Unexpected EXPLAIN output shape.');
  }
  const firstRow = raw[0] as Record<string, unknown>;
  const queryPlan = firstRow['QUERY PLAN'];
  if (!Array.isArray(queryPlan) || queryPlan.length === 0) {
    throw new Error('QUERY PLAN payload missing from EXPLAIN output.');
  }
  const planWrapper = queryPlan[0] as Record<string, unknown>;
  const planningTime = typeof planWrapper['Planning Time'] === 'number' ? planWrapper['Planning Time'] : 0;
  const executionTime = typeof planWrapper['Execution Time'] === 'number' ? planWrapper['Execution Time'] : 0;
  const planTree = planWrapper['Plan'] as PlanNode | undefined;
  if (!planTree) {
    throw new Error('Plan tree missing in EXPLAIN output.');
  }

  const stats: PlanStats = {
    scanTypes: new Set<string>(),
    indexNames: new Set<string>(),
    totalRows: 0,
  };

  traversePlan(planTree, stats);

  return {
    planningTimeMs: planningTime,
    executionTimeMs: executionTime,
    totalRows: stats.totalRows,
    scanTypes: Array.from(stats.scanTypes),
    indexNames: Array.from(stats.indexNames),
  };
}

async function analyzeQueries(): Promise<void> {
  const now = new Date();
  const reportEntries: QueryReportEntry[] = [];

  for (const definition of QUERY_DEFINITIONS) {
    const formattedSql = formatSqlWithParams(definition.sql, definition.parameters);
    const reportEntry: QueryReportEntry = {
      name: definition.name,
      query: formattedSql,
      metrics: null,
      warnings: [],
    };

    let transactionOpen = false;

    try {
      await prisma.$executeRawUnsafe('BEGIN');
      transactionOpen = true;

      const explainSql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${formattedSql}`;
      const rawPlan = await prisma.$queryRawUnsafe<unknown[]>(explainSql);

      await prisma.$executeRawUnsafe('ROLLBACK');
      transactionOpen = false;

      const metrics = parseExplainResult(rawPlan);
      reportEntry.metrics = metrics;

      const hasSequentialScan = metrics.scanTypes.some((type) => /Seq Scan/i.test(type));
      if (hasSequentialScan) {
        reportEntry.warnings.push('Sequential scan detected; evaluate indexing strategy.');
      }
      if (metrics.executionTimeMs > 100) {
        reportEntry.warnings.push(`Execution time ${metrics.executionTimeMs.toFixed(2)}ms exceeds 100ms threshold.`);
      }
      if (metrics.indexNames.length === 0 && !hasSequentialScan) {
        reportEntry.warnings.push('No index usage detected; confirm expected execution plan.');
      }
    } catch (error) {
      if (transactionOpen) {
        try {
          await prisma.$executeRawUnsafe('ROLLBACK');
        } catch (rollbackError) {
          console.error('Failed to rollback transaction after error:', rollbackError);
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to analyze query "${definition.name}":`, message);
      reportEntry.warnings.push(`Query analysis failed: ${message}`);
    }

    reportEntries.push(reportEntry);
  }

  const outputDir = path.join(process.cwd(), 'docs', 'validation', 'performance');
  await mkdir(outputDir, { recursive: true });
  const filename = `query-analysis-${formatTimestampForFilename(now)}.json`;
  const outputPath = path.join(outputDir, filename);

  const report = {
    timestamp: formatTimestamp(now),
    database: DATABASE_URL,
    queries: reportEntries,
  };

  await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Query analysis report written to ${outputPath}`);
}

async function main(): Promise<void> {
  try {
    await analyzeQueries();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Query analysis failed:', message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
