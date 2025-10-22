import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * PrismaReadReplicaService
 *
 * Manages separate Prisma connections for primary (read-write) and replica (read-only) databases.
 * Enables read query offloading while maintaining consistency guarantees.
 *
 * Features:
 * - Primary connection for all writes and strong consistency reads
 * - Replica connection for eventually consistent reads (history, metadata)
 * - Feature flags per endpoint to control replica usage
 * - Health checks for both connections
 * - Automatic connection management and pooling
 *
 * Environment Variables:
 * - DATABASE_URL: Primary database connection string (required)
 * - DATABASE_REPLICA_URL: Read replica connection string (optional)
 * - ENABLE_READ_REPLICAS: Global feature flag (default: false)
 * - REPLICA_CONNECTION_POOL_SIZE: Replica pool size (default: 30)
 */
@Injectable()
export class PrismaReadReplicaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaReadReplicaService.name);

  private primaryClient: PrismaClient | null = null;
  private replicaClient: PrismaClient | null = null;

  private readonly enabled: boolean;
  private readonly replicaUrl: string | undefined;
  private readonly primaryUrl: string;

  // Feature flags for per-endpoint replica routing
  private readonly endpointFlags: Map<string, boolean> = new Map();

  constructor() {
    this.primaryUrl = process.env.DATABASE_URL || "";
    this.replicaUrl = process.env.DATABASE_REPLICA_URL;
    this.enabled = process.env.ENABLE_READ_REPLICAS === "true";

    if (!this.primaryUrl) {
      throw new Error("DATABASE_URL is required");
    }

    // Initialize feature flags from environment
    this.initializeFeatureFlags();
  }

  async onModuleInit() {
    this.logger.log("Initializing database connections...");

    // Always create primary client
    this.primaryClient = await this.createPrismaClient(
      this.primaryUrl,
      "primary",
    );

    // Create replica client if enabled and URL provided
    if (this.enabled && this.replicaUrl) {
      try {
        this.replicaClient = await this.createPrismaClient(
          this.replicaUrl,
          "replica",
        );
        this.logger.log(
          `✅ Read replica enabled with ${this.replicaClient ? "SUCCESS" : "FALLBACK to primary"}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to initialize replica connection: ${error instanceof Error ? error.message : error}`,
        );
        this.logger.warn("Falling back to primary for all reads");
      }
    } else {
      const reason = !this.enabled
        ? "ENABLE_READ_REPLICAS=false"
        : "DATABASE_REPLICA_URL not set";
      this.logger.log(`Read replicas disabled (${reason})`);
    }

    // Validate connections
    await this.validateConnections();
  }

  async onModuleDestroy() {
    this.logger.log("Disconnecting database clients...");

    if (this.primaryClient) {
      await this.primaryClient.$disconnect();
      this.logger.log("✅ Primary client disconnected");
    }

    if (this.replicaClient) {
      await this.replicaClient.$disconnect();
      this.logger.log("✅ Replica client disconnected");
    }
  }

  /**
   * Get the primary database client (for writes and strong consistency reads)
   */
  getPrimary(): PrismaClient {
    if (!this.primaryClient) {
      throw new Error("Primary database client not initialized");
    }
    return this.primaryClient;
  }

  /**
   * Get the replica database client if available, otherwise fallback to primary
   * @param endpointName Optional endpoint name for feature flag check
   */
  getReplica(endpointName?: string): PrismaClient {
    // Check feature flag for specific endpoint
    if (endpointName && !this.isReplicaEnabledForEndpoint(endpointName)) {
      return this.getPrimary();
    }

    // Return replica if available, otherwise fallback to primary
    if (this.replicaClient && this.enabled) {
      return this.replicaClient;
    }

    return this.getPrimary();
  }

  /**
   * Check if read replicas are enabled globally
   */
  isReplicaEnabled(): boolean {
    return this.enabled && this.replicaClient !== null;
  }

  /**
   * Check if replica routing is enabled for a specific endpoint
   */
  isReplicaEnabledForEndpoint(endpointName: string): boolean {
    if (!this.isReplicaEnabled()) {
      return false;
    }

    const flag = this.endpointFlags.get(endpointName);
    return flag !== undefined ? flag : false; // Default: disabled unless explicitly enabled
  }

  /**
   * Enable replica routing for a specific endpoint (runtime toggle)
   */
  enableReplicaForEndpoint(endpointName: string): void {
    this.endpointFlags.set(endpointName, true);
    this.logger.log(`✅ Replica routing enabled for endpoint: ${endpointName}`);
  }

  /**
   * Disable replica routing for a specific endpoint (runtime toggle)
   */
  disableReplicaForEndpoint(endpointName: string): void {
    this.endpointFlags.set(endpointName, false);
    this.logger.warn(
      `⚠️  Replica routing disabled for endpoint: ${endpointName}`,
    );
  }

  /**
   * Get replica health status
   */
  async getReplicaHealth(): Promise<{
    enabled: boolean;
    available: boolean;
    latency?: number;
    error?: string;
  }> {
    if (!this.isReplicaEnabled()) {
      return {
        enabled: false,
        available: false,
      };
    }

    try {
      const start = Date.now();
      await this.replicaClient!.$queryRaw`SELECT 1`;
      const latency = Date.now() - start;

      return {
        enabled: true,
        available: true,
        latency,
      };
    } catch (error) {
      return {
        enabled: true,
        available: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get primary health status
   */
  async getPrimaryHealth(): Promise<{
    available: boolean;
    latency?: number;
    error?: string;
  }> {
    try {
      const start = Date.now();
      await this.primaryClient!.$queryRaw`SELECT 1`;
      const latency = Date.now() - start;

      return {
        available: true,
        latency,
      };
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * List all endpoints with their replica routing status
   */
  getEndpointFlags(): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    this.endpointFlags.forEach((enabled, endpoint) => {
      result[endpoint] = enabled;
    });
    return result;
  }

  /**
   * Create a Prisma client with appropriate configuration
   */
  private async createPrismaClient(
    connectionUrl: string,
    clientType: "primary" | "replica",
  ): Promise<PrismaClient> {
    const isDevelopment = process.env.NODE_ENV === "development";

    // Connection pool sizing
    // Replica can have larger pool since it's read-only (less contention)
    const poolSize =
      clientType === "replica"
        ? parseInt(process.env.REPLICA_CONNECTION_POOL_SIZE || "30", 10)
        : parseInt(process.env.DATABASE_POOL_SIZE || "50", 10);

    const connectionTimeout = parseInt(
      process.env.DATABASE_CONNECTION_TIMEOUT || "10",
      10,
    );
    const poolTimeout = parseInt(process.env.DATABASE_POOL_TIMEOUT || "30", 10);

    // Append connection pool parameters
    const separator = connectionUrl.includes("?") ? "&" : "?";
    const enhancedUrl = `${connectionUrl}${separator}connection_limit=${poolSize}&pool_timeout=${poolTimeout}&connect_timeout=${connectionTimeout}`;

    const logConfig = isDevelopment
      ? [
          { emit: "event" as const, level: "query" as const },
          { emit: "event" as const, level: "error" as const },
        ]
      : ["error" as const];

    const client = new PrismaClient({
      datasources: {
        db: {
          url: enhancedUrl,
        },
      },
      log: logConfig,
      errorFormat: isDevelopment ? "pretty" : "minimal",
    });

    // Add event listeners in development
    if (isDevelopment) {
      (client as any).$on("query", (e: any) => {
        this.logger.debug(
          `[${clientType.toUpperCase()}] Query: ${e.query.substring(0, 100)}... (${e.duration}ms)`,
        );
      });

      (client as any).$on("error", (e: any) => {
        this.logger.error(`[${clientType.toUpperCase()}] Error:`, e);
      });
    }

    // Connect and verify
    await client.$connect();
    await client.$queryRaw`SELECT 1`;

    this.logger.log(
      `✅ ${clientType.charAt(0).toUpperCase() + clientType.slice(1)} database connected (pool size: ${poolSize})`,
    );

    return client;
  }

  /**
   * Validate both database connections
   */
  private async validateConnections(): Promise<void> {
    const primaryHealth = await this.getPrimaryHealth();
    if (!primaryHealth.available) {
      throw new Error(
        `Primary database connection failed: ${primaryHealth.error}`,
      );
    }

    if (this.isReplicaEnabled()) {
      const replicaHealth = await this.getReplicaHealth();
      if (!replicaHealth.available) {
        this.logger.warn(
          `Replica connection unhealthy: ${replicaHealth.error}`,
        );
        this.logger.warn("Disabling replica routing until health recovers");
        // Don't throw - fallback to primary is acceptable
      }
    }
  }

  /**
   * Initialize feature flags from environment variables
   */
  private initializeFeatureFlags(): void {
    // Parse REPLICA_ENABLED_ENDPOINTS comma-separated list
    const enabledEndpoints = process.env.REPLICA_ENABLED_ENDPOINTS || "";

    if (enabledEndpoints) {
      enabledEndpoints.split(",").forEach((endpoint) => {
        const trimmed = endpoint.trim();
        if (trimmed) {
          this.endpointFlags.set(trimmed, true);
          this.logger.log(
            `Replica routing pre-enabled for endpoint: ${trimmed}`,
          );
        }
      });
    }

    // Default safe endpoints (can be overridden by environment)
    const defaultSafeEndpoints = [
      "message.history",
      "conversation.list",
      "user.profile",
    ];

    // Only auto-enable if REPLICA_ENABLED_ENDPOINTS not explicitly set
    if (!enabledEndpoints && this.enabled) {
      defaultSafeEndpoints.forEach((endpoint) => {
        if (!this.endpointFlags.has(endpoint)) {
          this.endpointFlags.set(endpoint, false); // Start disabled, enable manually in staging
          this.logger.debug(
            `Default endpoint registered (disabled): ${endpoint}`,
          );
        }
      });
    }
  }
}
