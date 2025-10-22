/**
 * KeysetPaginator
 *
 * Implements keyset (cursor-based) pagination using (createdAt, id) composite keys.
 * Replaces OFFSET pagination to maintain stable performance at any depth.
 *
 * Benefits over OFFSET pagination:
 * - O(log n) performance regardless of page depth (OFFSET is O(n))
 * - No drift when new records are inserted during pagination
 * - Works efficiently with composite indexes on (createdAt DESC, id DESC)
 * - Stable query plans and execution times
 *
 * Usage:
 * ```typescript
 * // First page
 * const result = await KeysetPaginator.paginate({
 *   query: (whereClause) => prisma.message.findMany({
 *     where: {
 *       conversationId,
 *       ...whereClause
 *     },
 *     orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
 *     take: 50,
 *   }),
 *   pageSize: 50,
 * });
 *
 * // Next page
 * const nextResult = await KeysetPaginator.paginate({
 *   query: (whereClause) => prisma.message.findMany({ ... }),
 *   pageSize: 50,
 *   cursor: result.nextCursor,
 * });
 * ```
 */

export interface KeysetCursor {
  createdAt: Date | string;
  id: string;
}

export interface PaginationResult<T> {
  data: T[];
  nextCursor: string | null;
  prevCursor: string | null;
  hasMore: boolean;
  pageSize: number;
}

export interface PaginationOptions<T> {
  query: (whereClause: any) => Promise<T[]>;
  pageSize: number;
  cursor?: string | null;
  direction?: "forward" | "backward";
}

export class KeysetPaginator {
  /**
   * Encode cursor from (createdAt, id) pair
   */
  static encodeCursor(createdAt: Date | string, id: string): string {
    const timestamp =
      createdAt instanceof Date ? createdAt.toISOString() : createdAt;
    const payload = JSON.stringify({ createdAt: timestamp, id });
    return Buffer.from(payload).toString("base64url");
  }

  /**
   * Decode cursor to (createdAt, id) pair
   * Returns null if cursor is invalid
   */
  static decodeCursor(cursor: string): KeysetCursor | null {
    try {
      const payload = Buffer.from(cursor, "base64url").toString("utf-8");
      const decoded = JSON.parse(payload);

      if (!decoded.createdAt || !decoded.id) {
        return null;
      }

      return {
        createdAt: new Date(decoded.createdAt),
        id: decoded.id,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Paginate results using keyset pagination
   *
   * @param options Pagination options
   * @returns Paginated result with cursors
   */
  static async paginate<T extends { createdAt: Date | string; id: string }>(
    options: PaginationOptions<T>,
  ): Promise<PaginationResult<T>> {
    const { query, pageSize, cursor, direction = "forward" } = options;

    // Decode cursor if provided
    const decodedCursor = cursor ? this.decodeCursor(cursor) : null;

    // Build WHERE clause for keyset pagination
    const whereClause = decodedCursor
      ? this.buildWhereClause(decodedCursor, direction)
      : {};

    // Fetch pageSize + 1 to determine if there are more results
    const results = await query(whereClause);

    // Determine if there are more results
    const hasMore = results.length > pageSize;
    const data = hasMore ? results.slice(0, pageSize) : results;

    // Generate cursors for next/prev pages
    const nextCursor =
      hasMore && data.length > 0
        ? this.encodeCursor(
            data[data.length - 1].createdAt,
            data[data.length - 1].id,
          )
        : null;

    const prevCursor =
      data.length > 0 && decodedCursor
        ? this.encodeCursor(data[0].createdAt, data[0].id)
        : null;

    return {
      data,
      nextCursor,
      prevCursor,
      hasMore,
      pageSize,
    };
  }

  /**
   * Build WHERE clause for keyset pagination
   * Uses composite key comparison for efficient indexed lookups
   */
  private static buildWhereClause(
    cursor: KeysetCursor,
    direction: "forward" | "backward",
  ): any {
    const timestamp =
      cursor.createdAt instanceof Date
        ? cursor.createdAt
        : new Date(cursor.createdAt);

    if (direction === "forward") {
      // Forward pagination: (createdAt, id) < (cursor.createdAt, cursor.id)
      // For DESC ordering
      return {
        OR: [
          {
            createdAt: { lt: timestamp },
          },
          {
            createdAt: timestamp,
            id: { lt: cursor.id },
          },
        ],
      };
    } else {
      // Backward pagination: (createdAt, id) > (cursor.createdAt, cursor.id)
      // For DESC ordering
      return {
        OR: [
          {
            createdAt: { gt: timestamp },
          },
          {
            createdAt: timestamp,
            id: { gt: cursor.id },
          },
        ],
      };
    }
  }

  /**
   * Helper: Paginate with custom order fields
   * Supports arbitrary (orderField, id) pairs
   */
  static async paginateCustom<T extends Record<string, any>>(options: {
    query: (whereClause: any) => Promise<T[]>;
    pageSize: number;
    cursor?: string | null;
    orderField: keyof T; // Field to order by (must be in cursor)
    orderDirection: "asc" | "desc";
  }): Promise<PaginationResult<T>> {
    const { query, pageSize, cursor, orderField, orderDirection } = options;

    // Decode cursor
    const decodedCursor = cursor ? this.decodeCursor(cursor) : null;

    // Build WHERE clause
    const whereClause = decodedCursor
      ? this.buildCustomWhereClause(
          decodedCursor,
          orderField as string,
          orderDirection,
        )
      : {};

    // Fetch results
    const results = await query(whereClause);

    // Determine if there are more results
    const hasMore = results.length > pageSize;
    const data = hasMore ? results.slice(0, pageSize) : results;

    // Generate cursors
    const nextCursor =
      hasMore && data.length > 0
        ? this.encodeCustomCursor(data[data.length - 1], orderField as string)
        : null;

    const prevCursor =
      data.length > 0 && decodedCursor
        ? this.encodeCustomCursor(data[0], orderField as string)
        : null;

    return {
      data,
      nextCursor,
      prevCursor,
      hasMore,
      pageSize,
    };
  }

  /**
   * Encode custom cursor from (orderField, id) pair
   */
  private static encodeCustomCursor(record: any, orderField: string): string {
    const payload = JSON.stringify({
      createdAt: record[orderField],
      id: record.id,
    });
    return Buffer.from(payload).toString("base64url");
  }

  /**
   * Build WHERE clause for custom order field
   */
  private static buildCustomWhereClause(
    cursor: KeysetCursor,
    orderField: string,
    orderDirection: "asc" | "desc",
  ): any {
    const value = cursor.createdAt; // Reuse createdAt field in cursor for any order field

    const operator = orderDirection === "desc" ? "lt" : "gt";
    const orOperator = orderDirection === "desc" ? "lt" : "gt";

    return {
      OR: [
        {
          [orderField]: { [operator]: value },
        },
        {
          [orderField]: value,
          id: { [orOperator]: cursor.id },
        },
      ],
    };
  }

  /**
   * Convert OFFSET pagination to cursor pagination
   * Useful for migration path from OFFSET-based APIs
   *
   * @deprecated Use cursor-based pagination directly
   */
  static async convertOffsetToCursor<
    T extends { createdAt: Date | string; id: string },
  >(
    query: () => Promise<T[]>,
    offset: number,
    limit: number,
  ): Promise<PaginationResult<T>> {
    // This is a compatibility shim - performance will degrade with large offsets
    const results = await query();
    const start = Math.max(0, offset);
    const end = Math.min(results.length, offset + limit);

    const data = results.slice(start, end);
    const hasMore = end < results.length;

    const nextCursor =
      hasMore && data.length > 0
        ? this.encodeCursor(
            data[data.length - 1].createdAt,
            data[data.length - 1].id,
          )
        : null;

    return {
      data,
      nextCursor,
      prevCursor: null,
      hasMore,
      pageSize: limit,
    };
  }
}

/**
 * Helper types for type-safe pagination
 */
export type PaginatedResponse<T> = PaginationResult<T>;

export interface PaginationRequest {
  cursor?: string;
  pageSize?: number;
  direction?: "forward" | "backward";
}

/**
 * Validate pagination request parameters
 */
export function validatePaginationRequest(request: PaginationRequest): {
  valid: boolean;
  error?: string;
} {
  const { cursor, pageSize, direction } = request;

  // Validate cursor
  if (cursor && !KeysetPaginator.decodeCursor(cursor)) {
    return { valid: false, error: "Invalid cursor format" };
  }

  // Validate pageSize
  if (pageSize !== undefined) {
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return { valid: false, error: "Page size must be between 1 and 100" };
    }
  }

  // Validate direction
  if (direction && direction !== "forward" && direction !== "backward") {
    return { valid: false, error: 'Direction must be "forward" or "backward"' };
  }

  return { valid: true };
}
