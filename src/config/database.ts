type PrismaClientMode = "database" | "mock";
type PrismaClientRequestMode = "auto" | "database" | "mock";

const requestedMode = (process.env.PRISMA_CLIENT_MODE || "auto")
  .toLowerCase()
  .trim() as PrismaClientRequestMode;

const fallbackReasons: string[] = [];
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

let prismaClientMode: PrismaClientMode;
let PrismaClient: new (...args: any[]) => any;
let Prisma: any;

function loadMockPrisma(reason?: string) {
  const mockModule = require("../infra/prisma/mock-prisma-client");
  PrismaClient = mockModule.PrismaClient;
  Prisma = mockModule.Prisma;
  prismaClientMode = "mock";

  if (reason) {
    console.warn(
      `⚠️  Prisma mock client active (${reason}). Set PRISMA_CLIENT_MODE=database after configuring PostgreSQL.`,
    );
  } else {
    console.log("ℹ️  Prisma mock client enabled (PRISMA_CLIENT_MODE=mock).");
  }
}

function tryLoadRealPrisma() {
  try {
    const prismaModule = require("@prisma/client");
    PrismaClient = prismaModule.PrismaClient;
    Prisma = prismaModule.Prisma;
    prismaClientMode = "database";
    return true;
  } catch (error) {
    fallbackReasons.push("@prisma/client dependency unavailable");
    return false;
  }
}

if (requestedMode === "mock") {
  loadMockPrisma();
} else {
  const realLoaded = tryLoadRealPrisma();

  if (!realLoaded && requestedMode === "database") {
    throw new Error(
      "PRISMA_CLIENT_MODE=database requires @prisma/client to be installed.",
    );
  }

  if (requestedMode === "database" && !hasDatabaseUrl) {
    throw new Error(
      "PRISMA_CLIENT_MODE=database requires DATABASE_URL to be set.",
    );
  }

  const canUseDatabase = realLoaded && hasDatabaseUrl;

  if (canUseDatabase) {
    prismaClientMode = "database";
  } else {
    if (!hasDatabaseUrl) {
      fallbackReasons.push("DATABASE_URL not set");
    }

    const reason =
      requestedMode === "database"
        ? fallbackReasons.join("; ") || "unknown reason"
        : fallbackReasons.join("; ") || "auto mode fallback";

    loadMockPrisma(reason);
  }
}

// Type definitions
type IPrismaClient = any;
type LogLevel = "info" | "query" | "warn" | "error";
type LogDefinition = {
  level: LogLevel;
  emit: "stdout" | "event";
};
type QueryEvent = {
  timestamp: Date;
  query: string;
  params: string;
  duration: number;
  target: string;
};
type LogEvent = {
  timestamp: Date;
  message: string;
  target: string;
};

// Type for database health check result
export interface DatabaseHealth {
  status: "healthy" | "unhealthy";
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
let prismaInstance: IPrismaClient | undefined;

/**
 * Creates and returns a singleton Prisma client instance
 * This ensures we don't create multiple database connections
 * which can lead to connection pool exhaustion
 */
function createPrismaClient(): IPrismaClient {
  const isDevelopment = process.env.NODE_ENV === "development";

  if (prismaClientMode === "mock") {
    return new PrismaClient();
  }

  const logConfig: LogLevel[] | LogDefinition[] = isDevelopment
    ? [
        { emit: "event", level: "query" },
        { emit: "event", level: "error" },
        { emit: "event", level: "info" },
        { emit: "event", level: "warn" },
      ]
    : ["error"];

  const client = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
    log: logConfig,
    errorFormat: isDevelopment ? "pretty" : "minimal",
  });

  if (isDevelopment && typeof client.$on === "function") {
    client.$on("query", (e: QueryEvent) => {
      console.log("Query: " + e.query);
      console.log("Params: " + e.params);
      console.log("Duration: " + e.duration + "ms");
      console.log("---");
    });

    client.$on("error", (e: LogEvent) => {
      console.error("Database error:", e);
    });

    client.$on("info", (e: LogEvent) => {
      console.info("Database info:", e);
    });

    client.$on("warn", (e: LogEvent) => {
      console.warn("Database warning:", e);
    });
  }

  return client;
}

/**
 * Get or create the singleton Prisma client instance
 * In development, we attach it to global to survive hot reloads
 */
function getPrismaClient(): IPrismaClient {
  if (process.env.NODE_ENV === "development") {
    // In development, use a global variable to preserve the instance
    // across hot reloads to avoid connection issues
    const globalWithPrisma = global as typeof globalThis & {
      __prisma?: IPrismaClient;
    };

    if (!globalWithPrisma.__prisma) {
      globalWithPrisma.__prisma = createPrismaClient();
    }
    return globalWithPrisma.__prisma;
  } else {
    if (!prismaInstance) {
      prismaInstance = createPrismaClient();
    }
    return prismaInstance;
  }
}

/**
 * Initialize the database connection
 * This should be called when the application starts
 */
export async function connectDatabase(): Promise<IPrismaClient> {
  const client = getPrismaClient();

  try {
    if (prismaClientMode === "mock") {
      if (typeof client.$connect === "function") {
        await client.$connect();
      }
      console.log(
        "⚠️  Prisma mock mode enabled - skipping external database connectivity checks.",
      );
      return client;
    }

    await client.$connect();
    console.log("✅ Database connected successfully");

    await client.$queryRaw`SELECT 1`;
    console.log("✅ Database connection test passed");

    return client;
  } catch (error) {
    console.error("❌ Failed to connect to database:", error);
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
    if (typeof client.$disconnect === "function") {
      await client.$disconnect();
    }
    if (prismaClientMode === "mock") {
      console.log("ℹ️  Prisma mock client disposed.");
    } else {
      console.log("✅ Database disconnected successfully");
    }
  } catch (error) {
    console.error("❌ Error disconnecting from database:", error);
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
    if (prismaClientMode === "mock") {
      return {
        status: "healthy",
        latency: "0ms",
        timestamp: new Date().toISOString(),
      };
    }

    const start = Date.now();
    await client.$queryRaw`SELECT 1`;
    const latency = Date.now() - start;

    return {
      status: "healthy",
      latency: `${latency}ms`,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: "unhealthy",
      error: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Execute a database transaction
 * Wrapper for Prisma's $transaction method
 */
export async function executeTransaction<T>(
  callback: (
    prisma: Omit<
      IPrismaClient,
      "$connect" | "$disconnect" | "$on" | "$transaction" | "$use"
    >,
  ) => Promise<T>,
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

  if (prismaClientMode === "mock") {
    return {
      connectionState: "mock",
      activeConnections: 0,
      idleConnections: 0,
      pendingConnections: 0,
    };
  }

  const unsafeClient = client as any;
  const provider = unsafeClient._activeProvider;
  const pool = provider?._connectionPool;

  return {
    connectionState: unsafeClient._connectionState || "unknown",
    activeConnections: pool?._activeConnections || 0,
    idleConnections: pool?._idleConnections || 0,
    pendingConnections: pool?._pendingConnections || 0,
  };
}

// Export the singleton instance
export const prisma = getPrismaClient();
export const activePrismaClientMode = prismaClientMode;
export const isPrismaMockMode = () => prismaClientMode === "mock";

// Export utility functions for direct access
export { createPrismaClient, getPrismaClient };

// Default export for convenience
export default prisma;

// Handle process termination gracefully
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, closing database connection...");
  await disconnectDatabase();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("SIGINT received, closing database connection...");
  await disconnectDatabase();
  process.exit(0);
});

// Handle uncaught exceptions
process.on("uncaughtException", async (error) => {
  console.error("Uncaught exception:", error);
  await disconnectDatabase();
  process.exit(1);
});

process.on("unhandledRejection", async (reason, promise) => {
  console.error("Unhandled rejection at:", promise, "reason:", reason);
  await disconnectDatabase();
  process.exit(1);
});
