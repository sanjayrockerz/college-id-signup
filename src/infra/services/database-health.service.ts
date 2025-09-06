import { Injectable, Logger } from '@nestjs/common';
import { checkDatabaseHealth, getDatabaseMetrics, type DatabaseHealth, type DatabaseMetrics } from '../../config/database';

@Injectable()
export class DatabaseHealthService {
  private readonly logger = new Logger(DatabaseHealthService.name);

  /**
   * Perform a comprehensive health check of the database
   */
  async performHealthCheck(): Promise<DatabaseHealth & { metrics?: DatabaseMetrics }> {
    try {
      // Get basic health status
      const health = await checkDatabaseHealth();
      
      // Get additional metrics if database is healthy
      let metrics: DatabaseMetrics | undefined;
      if (health.status === 'healthy') {
        try {
          metrics = getDatabaseMetrics();
        } catch (error) {
          this.logger.warn('Failed to get database metrics:', error);
        }
      }

      return {
        ...health,
        metrics,
      };
    } catch (error) {
      this.logger.error('Health check failed:', error);
      return {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Get detailed database connection information
   */
  getConnectionInfo(): DatabaseMetrics {
    return getDatabaseMetrics();
  }

  /**
   * Log database status periodically
   * Useful for monitoring and debugging
   */
  async logDatabaseStatus(): Promise<void> {
    const health = await this.performHealthCheck();
    
    if (health.status === 'healthy') {
      this.logger.log(`Database healthy - Latency: ${health.latency}`);
      if (health.metrics) {
        this.logger.debug(`Connection metrics: ${JSON.stringify(health.metrics)}`);
      }
    } else {
      this.logger.error(`Database unhealthy - Error: ${health.error}`);
    }
  }

  /**
   * Start periodic health monitoring
   * @param intervalMs Interval in milliseconds (default: 30 seconds)
   */
  startHealthMonitoring(intervalMs: number = 30000): NodeJS.Timeout {
    this.logger.log(`Starting database health monitoring (interval: ${intervalMs}ms)`);
    
    return setInterval(async () => {
      await this.logDatabaseStatus();
    }, intervalMs);
  }

  /**
   * Stop health monitoring
   */
  stopHealthMonitoring(interval: NodeJS.Timeout): void {
    clearInterval(interval);
    this.logger.log('Stopped database health monitoring');
  }
}
