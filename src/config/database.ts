import { PrismaClient, Prisma } from '@prisma/client';

// Type for database health check result
export interface DatabaseHealth {
  status: 'healthy' | 'unhealthy';
  latency?: string;
  error?: string;
  timestamp: string;
}

// Type for database metrics
export interface DatabaseMetrics {
  connectionState: string;
  activeConnections: number;
  idleConnections: number;
  pendingConnections: number;
}

// Global variable to store the singleton instance
let prisma: PrismaClient | undefined;

/**
 * Creates and returns a singleton Prisma client instance
 * This ensures we don't create multiple database connections
 * which can lead to connection pool exhaustion
 */
function createPrismaClient(): PrismaClient {
  // Check if we're in development mode
  const isDevelopment = process.env.NODE_ENV === 'development';
  const isProduction = process.env.NODE_ENV === 'production';

  // Configure logging based on environment
  const logConfig: Prisma.LogLevel[] | Prisma.LogDefinition[] = isDevelopment
    ? [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'info' },
        { emit: 'event', level: 'warn' },
      ]
    : ['error']; // Only log errors in production

  // Create Prisma client with environment-specific configuration
  const client = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
    log: logConfig,
    errorFormat: isDevelopment ? 'pretty' : 'minimal',
  });

  // Setup query logging for development
  if (isDevelopment) {
    client.$on('query', (e: Prisma.QueryEvent) => {
      console.log('Query: ' + e.query);
      console.log('Params: ' + e.params);
      console.log('Duration: ' + e.duration + 'ms');
      console.log('---');
    });

    client.$on('error', (e: Prisma.LogEvent) => {
      console.error('Database error:', e);
    });

    client.$on('info', (e: Prisma.LogEvent) => {
      console.info('Database info:', e);
    });

    client.$on('warn', (e: Prisma.LogEvent) => {
      console.warn('Database warning:', e);
    });
  }

  return client;
}

/**
 * Get or create the singleton Prisma client instance
 * In development, we attach it to global to survive hot reloads
 */
function getPrismaClient(): PrismaClient {
  if (process.env.NODE_ENV === 'development') {
    // In development, use a global variable to preserve the instance
    // across hot reloads to avoid connection issues
    const globalWithPrisma = global as typeof globalThis & {
      __prisma?: PrismaClient;
    };

    if (!globalWithPrisma.__prisma) {
      globalWithPrisma.__prisma = createPrismaClient();
    }
    return globalWithPrisma.__prisma;
  } else {
    // In production, use the module-level variable
    if (!prisma) {
      prisma = createPrismaClient();
    }
    return prisma;
  }
}

/**
 * Initialize the database connection
 * This should be called when the application starts
 */
export async function connectDatabase(): Promise<PrismaClient> {
  const client = getPrismaClient();
  
  try {
    await client.$connect();
    console.log('✅ Database connected successfully');
    
    // Test the connection
    await client.$queryRaw`SELECT 1`;
    console.log('✅ Database connection test passed');
    
    return client;
  } catch (error) {
    console.error('❌ Failed to connect to database:', error);
    throw error;
  }
}

/**
 * Gracefully disconnect from the database
 * This should be called when the application shuts down
 */
export async function disconnectDatabase(): Promise<void> {
  const client = getPrismaClient();
  
  try {
    await client.$disconnect();
    console.log('✅ Database disconnected successfully');
  } catch (error) {
    console.error('❌ Error disconnecting from database:', error);
    throw error;
  }
}

/**
 * Check database health
 * Useful for health check endpoints
 */
export async function checkDatabaseHealth(): Promise<DatabaseHealth> {
  const client = getPrismaClient();
  
  try {
    const start = Date.now();
    await client.$queryRaw`SELECT 1`;
    const latency = Date.now() - start;
    
    return {
      status: 'healthy',
      latency: `${latency}ms`,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Execute a database transaction
 * Wrapper for Prisma's $transaction method
 */
export async function executeTransaction<T>(
  callback: (prisma: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use'>) => Promise<T>
): Promise<T> {
  const client = getPrismaClient();
  return await client.$transaction(callback);
}

/**
 * Get database metrics
 * Useful for monitoring and debugging
 */
export function getDatabaseMetrics(): DatabaseMetrics {
  const client = getPrismaClient();
  
  return {
    connectionState: (client as any)._connectionState || 'unknown',
    activeConnections: (client as any)._activeProvider?._connectionPool?._activeConnections || 0,
    idleConnections: (client as any)._activeProvider?._connectionPool?._idleConnections || 0,
    pendingConnections: (client as any)._activeProvider?._connectionPool?._pendingConnections || 0,
  };
}

// Export the singleton instance
export const prisma = getPrismaClient();

// Export utility functions for direct access
export {
  createPrismaClient,
  getPrismaClient,
};

// Default export for convenience
export default prisma;

// Handle process termination gracefully
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing database connection...');
  await disconnectDatabase();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing database connection...');
  await disconnectDatabase();
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
  console.error('Uncaught exception:', error);
  await disconnectDatabase();
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  await disconnectDatabase();
  process.exit(1);
});
