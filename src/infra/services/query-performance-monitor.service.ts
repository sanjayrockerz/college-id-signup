import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TelemetryMetrics } from "../../observability/metrics-registry";

/**
 * QueryPerformanceMonitor
 *
 * Tracks query performance using Prisma middleware to emit query duration histograms.
 *
 * WHAT IT TRACKS:
 * 1. Query Duration: Latency of individual queries by model and operation
 * 2. Slow Queries: Queries exceeding SLO thresholds
 * 3. Query Type Distribution: Breakdown by SELECT/INSERT/UPDATE/DELETE
 *
 * SLO THRESHOLDS:
 * - P50 < 50ms (median response time)
 * - P95 < 200ms (95th percentile)
 * - P99 < 500ms (99th percentile)
 * - Slow query threshold: > 1000ms
 *
 * METRICS EMITTED:
 * - query_duration_ms{endpoint, query_type, model} - Histogram
 * - slow_query_total{endpoint, model, threshold} - Counter
 * - query_error_total{endpoint, model, error_type} - Counter
 *
 * IMPLEMENTATION:
 * Uses Prisma middleware ($use) to intercept all database operations and measure timing.
 *
 * ENDPOINT DETECTION:
 * Extracts endpoint context from:
 * 1. AsyncLocalStorage context (if available)
 * 2. Query comments (if enabled)
 * 3. Model name fallback
 *
 * @see DatabaseAccessLayer for read routing integration
 * @see READ_REPLICA_PLAYBOOK.md for query optimization patterns
 */

export interface QueryMetrics {
  model: string;
  action: string;
  endpoint: string;
  durationMs: number;
  timestamp: Date;
  slow: boolean;
}

export interface SlowQueryLog {
  query: string;
  model: string;
  action: string;
  durationMs: number;
  timestamp: Date;
  params?: any;
}

@Injectable()
export class QueryPerformanceMonitor implements OnModuleInit {
  private readonly logger = new Logger(QueryPerformanceMonitor.name);

  /** Slow query threshold in milliseconds */
  private readonly SLOW_QUERY_THRESHOLD_MS = parseInt(
    process.env.SLOW_QUERY_THRESHOLD_MS || "1000",
    10,
  );

  /** Enable detailed slow query logging */
  private readonly LOG_SLOW_QUERIES = process.env.LOG_SLOW_QUERIES !== "false";

  /** Recent slow queries buffer (for debugging) */
  private slowQueryBuffer: SlowQueryLog[] = [];
  private readonly MAX_SLOW_QUERY_BUFFER = 100;

  /** SLO thresholds for alerting */
  private readonly SLO_THRESHOLDS = {
    p50: 50, // 50ms
    p95: 200, // 200ms
    p99: 500, // 500ms
  };

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    this.logger.log("QueryPerformanceMonitor initialized");
    this.logger.log(`Slow query threshold: ${this.SLOW_QUERY_THRESHOLD_MS}ms`);
    this.registerPrismaMiddleware();
  }

  /**
   * Register Prisma middleware to track all queries
   */
  private registerPrismaMiddleware(): void {
    // @ts-expect-error - Prisma middleware typing
    this.prisma.$use(async (params: any, next: any) => {
      const start = Date.now();

      try {
        // Execute query
        const result = await next(params);

        // Measure duration
        const durationMs = Date.now() - start;

        // Record metrics
        this.recordQueryMetrics(params, durationMs, false);

        // Log slow queries
        if (durationMs > this.SLOW_QUERY_THRESHOLD_MS) {
          this.handleSlowQuery(params, durationMs);
        }

        return result;
      } catch (error) {
        // Measure duration even for failed queries
        const durationMs = Date.now() - start;

        // Record error metrics
        this.recordQueryMetrics(params, durationMs, true);

        // Re-throw error
        throw error;
      }
    });

    this.logger.log(
      "Prisma middleware registered for query performance tracking",
    );
  }

  /**
   * Record query metrics to Prometheus
   */
  private recordQueryMetrics(
    params: any,
    durationMs: number,
    isError: boolean,
  ): void {
    const model = params.model || "unknown";
    const action = params.action || "unknown";

    // Determine endpoint from model + action
    const endpoint = this.resolveEndpoint(model, action);

    // Map Prisma action to query type
    const queryType = this.mapActionToQueryType(action);

    // Emit histogram metric
    TelemetryMetrics.observeQueryDuration(
      endpoint,
      queryType,
      model,
      durationMs,
    );

    // Track slow queries
    if (durationMs > this.SLOW_QUERY_THRESHOLD_MS) {
      TelemetryMetrics.incrementSlowQuery(endpoint, model, "slow");
    }

    // Track errors
    if (isError) {
      TelemetryMetrics.incrementQueryError(endpoint, model, "execution");
    }
  }

  /**
   * Map Prisma action to standard query type
   */
  private mapActionToQueryType(action: string): string {
    switch (action) {
      case "findUnique":
      case "findFirst":
      case "findMany":
      case "count":
      case "aggregate":
      case "groupBy":
        return "select";

      case "create":
      case "createMany":
        return "insert";

      case "update":
      case "updateMany":
      case "upsert":
        return "update";

      case "delete":
      case "deleteMany":
        return "delete";

      case "executeRaw":
      case "queryRaw":
        return "raw";

      default:
        return "other";
    }
  }

  /**
   * Resolve endpoint name from model and action
   *
   * This is a simplified version. In production, use AsyncLocalStorage
   * to track the actual HTTP endpoint context.
   */
  private resolveEndpoint(model: string, action: string): string {
    // Try to get from AsyncLocalStorage context (if implemented)
    // const context = AsyncLocalStorage.getStore();
    // if (context?.endpoint) return context.endpoint;

    // Fallback: derive from model + action
    return `${model.toLowerCase()}.${action}`;
  }

  /**
   * Handle slow query logging and alerting
   */
  private handleSlowQuery(params: any, durationMs: number): void {
    const slowQuery: SlowQueryLog = {
      query: `${params.model}.${params.action}`,
      model: params.model || "unknown",
      action: params.action || "unknown",
      durationMs,
      timestamp: new Date(),
      params: this.sanitizeParams(params.args),
    };

    // Add to buffer
    this.slowQueryBuffer.push(slowQuery);
    if (this.slowQueryBuffer.length > this.MAX_SLOW_QUERY_BUFFER) {
      this.slowQueryBuffer.shift(); // Remove oldest
    }

    // Log warning
    if (this.LOG_SLOW_QUERIES) {
      this.logger.warn(
        `SLOW QUERY (${durationMs}ms > ${this.SLOW_QUERY_THRESHOLD_MS}ms): ` +
          `${slowQuery.query} ` +
          `[params: ${JSON.stringify(slowQuery.params)}]`,
      );
    }
  }

  /**
   * Sanitize params for logging (remove sensitive data, truncate large objects)
   */
  private sanitizeParams(params: any): any {
    if (!params) return undefined;

    try {
      const sanitized = { ...params };

      // Remove sensitive fields
      const sensitiveFields = ["password", "token", "secret", "apiKey"];
      for (const field of sensitiveFields) {
        if (sanitized[field]) {
          sanitized[field] = "[REDACTED]";
        }
        if (sanitized.data?.[field]) {
          sanitized.data[field] = "[REDACTED]";
        }
      }

      // Truncate large arrays
      if (
        sanitized.data?.ids &&
        Array.isArray(sanitized.data.ids) &&
        sanitized.data.ids.length > 10
      ) {
        sanitized.data.ids = `[${sanitized.data.ids.length} items]`;
      }

      return sanitized;
    } catch (error) {
      return "[sanitization error]";
    }
  }

  /**
   * Get recent slow queries for debugging
   */
  getRecentSlowQueries(limit: number = 20): SlowQueryLog[] {
    return this.slowQueryBuffer.slice(-limit);
  }

  /**
   * Clear slow query buffer
   */
  clearSlowQueryBuffer(): void {
    this.slowQueryBuffer = [];
  }

  /**
   * Get query performance summary
   */
  getSummary(): {
    slowQueryThreshold: number;
    recentSlowQueries: number;
    sloThresholds: { p50: number; p95: number; p99: number };
  } {
    return {
      slowQueryThreshold: this.SLOW_QUERY_THRESHOLD_MS,
      recentSlowQueries: this.slowQueryBuffer.length,
      sloThresholds: this.SLO_THRESHOLDS,
    };
  }
}
