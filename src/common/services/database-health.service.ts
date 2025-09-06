import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Injectable()
export class DatabaseHealthService {
  private readonly logger = new Logger(DatabaseHealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async checkDatabaseConnection(): Promise<{
    status: 'connected' | 'disconnected' | 'mock';
    message: string;
    details?: any;
  }> {
    try {
      this.logger.log('Checking database connection...');
      
      // Check if using mock client
      if ('__isMockClient' in this.prisma && this.prisma['__isMockClient']) {
        return {
          status: 'mock',
          message: 'Using mock Prisma client - no real database connection',
          details: {
            type: 'mock',
            environment: process.env.NODE_ENV || 'development',
            databaseUrl: process.env.DATABASE_URL ? 'configured' : 'not configured'
          }
        };
      }

      // Try to connect to real database
      await this.prisma.$connect();
      
      // Test a simple query (works with real Prisma, mock will skip)
      let queryResult = null;
      try {
        if ('$queryRaw' in this.prisma) {
          queryResult = await (this.prisma as any).$queryRaw`SELECT NOW() as current_time`;
        }
      } catch (queryError) {
        // Mock client won't support raw queries, that's fine
      }
      
      this.logger.log('Database connection successful');
      return {
        status: 'connected',
        message: 'Successfully connected to PostgreSQL database',
        details: {
          type: 'postgresql',
          currentTime: queryResult?.[0]?.current_time,
          environment: process.env.NODE_ENV || 'development'
        }
      };
      
    } catch (error: any) {
      this.logger.error('Database connection failed:', error?.message || error);
      
      return {
        status: 'disconnected',
        message: `Database connection failed: ${error?.message || 'Unknown error'}`,
        details: {
          error: error?.message || 'Unknown error',
          code: error?.code,
          environment: process.env.NODE_ENV || 'development',
          databaseUrl: process.env.DATABASE_URL ? 'configured' : 'not configured'
        }
      };
    }
  }

  async testDatabaseOperations(): Promise<{
    success: boolean;
    operations: any[];
    errors: string[];
  }> {
    const operations = [];
    const errors = [];

    try {
      this.logger.log('Testing database operations...');

      // Test 1: Check if tables exist (mock client will return mock data)
      try {
        const userCount = await this.prisma.user.count({});
        operations.push({
          operation: 'user.count()',
          success: true,
          result: `Found ${userCount} users`
        });
      } catch (error: any) {
        operations.push({
          operation: 'user.count()',
          success: false,
          error: error?.message || 'Unknown error'
        });
        errors.push(`User count failed: ${error?.message || 'Unknown error'}`);
      }

      // Test 2: Check posts table
      try {
        const postCount = await this.prisma.post.count({});
        operations.push({
          operation: 'post.count()',
          success: true,
          result: `Found ${postCount} posts`
        });
      } catch (error: any) {
        operations.push({
          operation: 'post.count()',
          success: false,
          error: error?.message || 'Unknown error'
        });
        errors.push(`Post count failed: ${error?.message || 'Unknown error'}`);
      }

      // Test 3: Check connections table
      try {
        const connectionCount = await this.prisma.connection.count({});
        operations.push({
          operation: 'connection.count()',
          success: true,
          result: `Found ${connectionCount} connections`
        });
      } catch (error: any) {
        operations.push({
          operation: 'connection.count()',
          success: false,
          error: error?.message || 'Unknown error'
        });
        errors.push(`Connection count failed: ${error?.message || 'Unknown error'}`);
      }

      this.logger.log(`Database operations test completed. ${operations.length} operations, ${errors.length} errors`);

      return {
        success: errors.length === 0,
        operations,
        errors
      };

    } catch (error: any) {
      this.logger.error('Database operations test failed:', error?.message || error);
      return {
        success: false,
        operations,
        errors: [...errors, error?.message || 'Unknown error']
      };
    }
  }
}
