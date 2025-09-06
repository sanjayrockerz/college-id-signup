import { Controller, Get } from '@nestjs/common';
import { DatabaseHealthService } from '../services/database-health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly databaseHealthService: DatabaseHealthService) {}

  @Get('database')
  async checkDatabaseHealth() {
    const connectionStatus = await this.databaseHealthService.checkDatabaseConnection();
    const operationsTest = await this.databaseHealthService.testDatabaseOperations();

    return {
      timestamp: new Date().toISOString(),
      connection: connectionStatus,
      operations: operationsTest,
      summary: {
        overall: connectionStatus.status === 'connected' && operationsTest.success ? 'healthy' : 
                connectionStatus.status === 'mock' ? 'mock' : 'unhealthy',
        database: connectionStatus.status,
        operationsSuccessful: operationsTest.success,
        totalOperations: operationsTest.operations.length,
        errors: operationsTest.errors.length
      }
    };
  }

  @Get()
  async getHealthStatus() {
    const dbHealth = await this.checkDatabaseHealth();
    
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      database: dbHealth.summary,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.version
    };
  }
}
