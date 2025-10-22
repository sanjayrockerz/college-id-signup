import { Controller, Get } from "@nestjs/common";
import { DatabaseHealthService } from "../services/database-health.service";
import { CacheService } from "../services/cache.service";
import { DbConnectionMonitor } from "../../infra/services/db-connection-monitor.service";

@Controller("health")
export class HealthController {
  constructor(
    private readonly databaseHealthService: DatabaseHealthService,
    private readonly cacheService: CacheService,
    private readonly dbConnectionMonitor: DbConnectionMonitor,
  ) {}

  @Get("database")
  async checkDatabaseHealth() {
    const connectionStatus =
      await this.databaseHealthService.checkDatabaseConnection();
    const operationsTest =
      await this.databaseHealthService.testDatabaseOperations();

    return {
      timestamp: new Date().toISOString(),
      connection: connectionStatus,
      operations: operationsTest,
      summary: {
        overall:
          connectionStatus.status === "connected" && operationsTest.success
            ? "healthy"
            : connectionStatus.status === "mock"
              ? "mock"
              : "unhealthy",
        database: connectionStatus.status,
        operationsSuccessful: operationsTest.success,
        totalOperations: operationsTest.operations.length,
        errors: operationsTest.errors.length,
      },
    };
  }

  @Get()
  async getHealthStatus() {
    const dbHealth = await this.checkDatabaseHealth();
    const cacheHealthy = await this.cacheService.healthCheck();
    const cacheMetrics = this.cacheService.getMetrics();
    const poolHealthy = await this.dbConnectionMonitor.isPoolHealthy();
    const poolSaturation = await this.dbConnectionMonitor.getPoolSaturation();
    const avgQueueWait = await this.dbConnectionMonitor.getAvgQueueWait();

    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || "development",
      database: dbHealth.summary,
      connection_pool: {
        healthy: poolHealthy,
        saturation: (poolSaturation * 100).toFixed(1) + "%",
        avg_queue_wait_ms: avgQueueWait.toFixed(2),
        status:
          poolSaturation > 0.9
            ? "critical"
            : poolSaturation > 0.7
              ? "warning"
              : "ok",
      },
      cache: {
        healthy: cacheHealthy,
        metrics: {
          hits: cacheMetrics.hits,
          misses: cacheMetrics.misses,
          hit_ratio: (cacheMetrics.hit_ratio * 100).toFixed(2) + "%",
          total_requests: cacheMetrics.total_requests,
        },
      },
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.version,
    };
  }

  @Get("cache")
  async getCacheMetrics() {
    const healthy = await this.cacheService.healthCheck();
    const metrics = this.cacheService.getMetrics();

    return {
      healthy,
      metrics: {
        ...metrics,
        hit_ratio_percentage: (metrics.hit_ratio * 100).toFixed(2) + "%",
      },
      timestamp: new Date().toISOString(),
    };
  }

  @Get("connection-pool")
  async getConnectionPoolStatus() {
    const healthy = await this.dbConnectionMonitor.isPoolHealthy();
    const saturation = await this.dbConnectionMonitor.getPoolSaturation();
    const queueWait = await this.dbConnectionMonitor.getAvgQueueWait();

    return {
      healthy,
      saturation: {
        value: saturation,
        percentage: (saturation * 100).toFixed(1) + "%",
        status:
          saturation > 0.9 ? "critical" : saturation > 0.7 ? "warning" : "ok",
      },
      queue: {
        avg_wait_ms: queueWait,
        status:
          queueWait > 500 ? "critical" : queueWait > 100 ? "warning" : "ok",
      },
      recommendations: this.getPoolRecommendations(saturation, queueWait),
      timestamp: new Date().toISOString(),
    };
  }

  private getPoolRecommendations(
    saturation: number,
    queueWait: number,
  ): string[] {
    const recommendations: string[] = [];

    if (saturation > 0.9) {
      recommendations.push(
        "CRITICAL: Pool saturation > 90%. Scale horizontally or increase pool size immediately.",
      );
    } else if (saturation > 0.8) {
      recommendations.push(
        "WARNING: Pool saturation > 80%. Consider scaling or optimizing queries.",
      );
    }

    if (queueWait > 500) {
      recommendations.push(
        "CRITICAL: Average queue wait > 500ms. Check for long-running transactions or slow queries.",
      );
    } else if (queueWait > 100) {
      recommendations.push(
        "WARNING: Average queue wait > 100ms. Monitor query performance and connection usage.",
      );
    }

    if (recommendations.length === 0) {
      recommendations.push("Pool is operating within healthy parameters.");
    }

    return recommendations;
  }
}
