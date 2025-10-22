import { Injectable, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PrismaReadReplicaService } from "./prisma-read-replica.service";
import { ReadReplicaCircuitBreaker } from "./read-replica-circuit-breaker.service";

/**
 * DatabaseAccessLayer
 *
 * Centralized data access abstraction that intelligently routes read queries
 * to replicas when safe, and always routes writes to primary.
 *
 * Features:
 * - Automatic routing based on operation type (read vs write)
 * - Per-endpoint feature flags for replica routing
 * - Circuit breaker integration for automatic fallback
 * - Consistent API for all database operations
 *
 * Usage:
 * ```typescript
 * // Read operation (can use replica)
 * const messages = await dal.findMany('message.history', prisma =>
 *   prisma.message.findMany({ where: { conversationId } })
 * );
 *
 * // Write operation (always uses primary)
 * const message = await dal.create('message.create', prisma =>
 *   prisma.message.create({ data: messageData })
 * );
 * ```
 */
@Injectable()
export class DatabaseAccessLayer {
  private readonly logger = new Logger(DatabaseAccessLayer.name);

  constructor(
    private readonly replicaService: PrismaReadReplicaService,
    private readonly circuitBreaker: ReadReplicaCircuitBreaker,
  ) {}

  /**
   * Execute a read query with optional replica routing
   *
   * @param endpointName Endpoint identifier for feature flags and metrics
   * @param query Function that executes the query on provided Prisma client
   * @param options Options for replica routing
   * @returns Query result
   */
  async findMany<T>(
    endpointName: string,
    query: (prisma: PrismaClient) => Promise<T>,
    options?: {
      useReplica?: boolean; // Explicitly enable/disable replica (default: auto)
      requireStrongConsistency?: boolean; // Force primary read (default: false)
    },
  ): Promise<T> {
    const useReplica = this.shouldUseReplica(endpointName, options);
    const client = useReplica
      ? this.replicaService.getReplica(endpointName)
      : this.replicaService.getPrimary();

    try {
      const result = await query(client);

      // Record success if we used replica
      if (useReplica) {
        this.circuitBreaker.recordSuccess();
      }

      return result;
    } catch (error) {
      // Record failure if we used replica
      if (useReplica) {
        this.circuitBreaker.recordFailure();
        this.logger.error(
          `Replica read failed for ${endpointName}, falling back to primary`,
          error,
        );

        // Retry on primary
        return query(this.replicaService.getPrimary());
      }

      throw error;
    }
  }

  /**
   * Execute a single-record read query with optional replica routing
   */
  async findUnique<T>(
    endpointName: string,
    query: (prisma: PrismaClient) => Promise<T>,
    options?: {
      useReplica?: boolean;
      requireStrongConsistency?: boolean;
    },
  ): Promise<T> {
    return this.findMany(endpointName, query, options);
  }

  /**
   * Execute a single-record read query (may return null)
   */
  async findFirst<T>(
    endpointName: string,
    query: (prisma: PrismaClient) => Promise<T | null>,
    options?: {
      useReplica?: boolean;
      requireStrongConsistency?: boolean;
    },
  ): Promise<T | null> {
    return this.findMany(endpointName, query, options);
  }

  /**
   * Execute a count query with optional replica routing
   */
  async count(
    endpointName: string,
    query: (prisma: PrismaClient) => Promise<number>,
    options?: {
      useReplica?: boolean;
      requireStrongConsistency?: boolean;
    },
  ): Promise<number> {
    return this.findMany(endpointName, query, options);
  }

  /**
   * Execute an aggregate query with optional replica routing
   */
  async aggregate<T>(
    endpointName: string,
    query: (prisma: PrismaClient) => Promise<T>,
    options?: {
      useReplica?: boolean;
      requireStrongConsistency?: boolean;
    },
  ): Promise<T> {
    return this.findMany(endpointName, query, options);
  }

  /**
   * Execute a write operation (always uses primary)
   */
  async create<T>(
    endpointName: string,
    mutation: (prisma: PrismaClient) => Promise<T>,
  ): Promise<T> {
    const client = this.replicaService.getPrimary();
    return mutation(client);
  }

  /**
   * Execute an update operation (always uses primary)
   */
  async update<T>(
    endpointName: string,
    mutation: (prisma: PrismaClient) => Promise<T>,
  ): Promise<T> {
    const client = this.replicaService.getPrimary();
    return mutation(client);
  }

  /**
   * Execute a delete operation (always uses primary)
   */
  async delete<T>(
    endpointName: string,
    mutation: (prisma: PrismaClient) => Promise<T>,
  ): Promise<T> {
    const client = this.replicaService.getPrimary();
    return mutation(client);
  }

  /**
   * Execute an upsert operation (always uses primary)
   */
  async upsert<T>(
    endpointName: string,
    mutation: (prisma: PrismaClient) => Promise<T>,
  ): Promise<T> {
    const client = this.replicaService.getPrimary();
    return mutation(client);
  }

  /**
   * Execute a createMany operation (always uses primary)
   */
  async createMany<T>(
    endpointName: string,
    mutation: (prisma: PrismaClient) => Promise<T>,
  ): Promise<T> {
    const client = this.replicaService.getPrimary();
    return mutation(client);
  }

  /**
   * Execute an updateMany operation (always uses primary)
   */
  async updateMany<T>(
    endpointName: string,
    mutation: (prisma: PrismaClient) => Promise<T>,
  ): Promise<T> {
    const client = this.replicaService.getPrimary();
    return mutation(client);
  }

  /**
   * Execute a deleteMany operation (always uses primary)
   */
  async deleteMany<T>(
    endpointName: string,
    mutation: (prisma: PrismaClient) => Promise<T>,
  ): Promise<T> {
    const client = this.replicaService.getPrimary();
    return mutation(client);
  }

  /**
   * Execute a transaction (always uses primary)
   * Transactions require strong consistency and should never use replicas
   */
  async transaction<T>(
    endpointName: string,
    callback: (prisma: PrismaClient) => Promise<T>,
  ): Promise<T> {
    const client = this.replicaService.getPrimary();

    // Use Prisma's $transaction method for atomicity
    return (client as any).$transaction(async (tx: PrismaClient) => {
      return callback(tx);
    });
  }

  /**
   * Get direct access to primary client (for advanced use cases)
   * Use sparingly - prefer using the DAL methods for proper routing
   */
  getPrimaryClient(): PrismaClient {
    return this.replicaService.getPrimary();
  }

  /**
   * Get direct access to replica client (for advanced use cases)
   * Returns primary if replica not available or circuit breaker is open
   */
  getReplicaClient(endpointName: string): PrismaClient {
    if (this.circuitBreaker.canRouteToReplica(endpointName)) {
      return this.replicaService.getReplica(endpointName);
    }
    return this.replicaService.getPrimary();
  }

  /**
   * Determine if replica should be used for a read operation
   */
  private shouldUseReplica(
    endpointName: string,
    options?: {
      useReplica?: boolean;
      requireStrongConsistency?: boolean;
    },
  ): boolean {
    // Explicit strong consistency requirement always uses primary
    if (options?.requireStrongConsistency) {
      return false;
    }

    // Explicit useReplica flag
    if (options?.useReplica !== undefined) {
      return (
        options.useReplica &&
        this.circuitBreaker.canRouteToReplica(endpointName)
      );
    }

    // Default: check circuit breaker and feature flags
    return this.circuitBreaker.canRouteToReplica(endpointName);
  }

  /**
   * Get replica routing status for health checks
   */
  getRoutingStatus(): {
    replicaEnabled: boolean;
    circuitBreakerState: string;
    lagStatus: any;
  } {
    return {
      replicaEnabled: this.replicaService.isReplicaEnabled(),
      circuitBreakerState: this.circuitBreaker.getStatus().state,
      lagStatus: this.circuitBreaker.getStatus().lagStatus,
    };
  }
}
