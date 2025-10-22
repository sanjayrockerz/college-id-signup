/**
 * Producer Error Classes for Hot-Path Validation
 *
 * Clear error hierarchy for rejection reasons:
 * - Schema validation failures
 * - Authorization failures
 * - Rate limiting
 * - Invalid state transitions
 *
 * Each error includes:
 * - HTTP status code
 * - Machine-readable error code
 * - User-friendly message
 * - Telemetry labels
 */

export enum ProducerErrorCode {
  // Schema validation (400)
  INVALID_SCHEMA = "INVALID_SCHEMA",
  MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD",
  INVALID_FIELD_TYPE = "INVALID_FIELD_TYPE",
  FIELD_TOO_LONG = "FIELD_TOO_LONG",
  INVALID_RECIPIENT = "INVALID_RECIPIENT",

  // Authorization (401, 403)
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  CONVERSATION_NOT_FOUND = "CONVERSATION_NOT_FOUND",
  NOT_CONVERSATION_MEMBER = "NOT_CONVERSATION_MEMBER",

  // Rate limiting (429)
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",

  // State validation (409)
  CONVERSATION_INACTIVE = "CONVERSATION_INACTIVE",
  USER_BLOCKED = "USER_BLOCKED",

  // Internal (500)
  ENQUEUE_FAILED = "ENQUEUE_FAILED",
}

export class ProducerError extends Error {
  constructor(
    public readonly code: ProducerErrorCode,
    public readonly statusCode: number,
    public readonly message: string,
    public readonly details?: Record<string, any>,
  ) {
    super(message);
    this.name = "ProducerError";

    // Maintain proper stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Convert to API response format
   */
  toResponse() {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
      },
    };
  }

  /**
   * Get telemetry label for rejection reason
   */
  getTelemetryLabel(): string {
    return this.code.toLowerCase();
  }
}

// Schema Validation Errors (400)

export class InvalidSchemaError extends ProducerError {
  constructor(message: string, details?: Record<string, any>) {
    super(ProducerErrorCode.INVALID_SCHEMA, 400, message, details);
    this.name = "InvalidSchemaError";
  }
}

export class MissingRequiredFieldError extends ProducerError {
  constructor(field: string) {
    super(
      ProducerErrorCode.MISSING_REQUIRED_FIELD,
      400,
      `Missing required field: ${field}`,
      { field },
    );
    this.name = "MissingRequiredFieldError";
  }
}

export class InvalidFieldTypeError extends ProducerError {
  constructor(field: string, expectedType: string, actualType: string) {
    super(
      ProducerErrorCode.INVALID_FIELD_TYPE,
      400,
      `Invalid type for field "${field}": expected ${expectedType}, got ${actualType}`,
      { field, expectedType, actualType },
    );
    this.name = "InvalidFieldTypeError";
  }
}

export class FieldTooLongError extends ProducerError {
  constructor(field: string, maxLength: number, actualLength: number) {
    super(
      ProducerErrorCode.FIELD_TOO_LONG,
      400,
      `Field "${field}" exceeds maximum length: ${actualLength} > ${maxLength}`,
      { field, maxLength, actualLength },
    );
    this.name = "FieldTooLongError";
  }
}

export class InvalidRecipientError extends ProducerError {
  constructor(recipientId: string, reason: string) {
    super(
      ProducerErrorCode.INVALID_RECIPIENT,
      400,
      `Invalid recipient "${recipientId}": ${reason}`,
      { recipientId, reason },
    );
    this.name = "InvalidRecipientError";
  }
}

// Authorization Errors (401, 403)

export class UnauthorizedError extends ProducerError {
  constructor(message: string = "Authentication required") {
    super(ProducerErrorCode.UNAUTHORIZED, 401, message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends ProducerError {
  constructor(message: string = "Access forbidden") {
    super(ProducerErrorCode.FORBIDDEN, 403, message);
    this.name = "ForbiddenError";
  }
}

export class ConversationNotFoundError extends ProducerError {
  constructor(conversationId: string) {
    super(
      ProducerErrorCode.CONVERSATION_NOT_FOUND,
      404,
      `Conversation not found: ${conversationId}`,
      { conversationId },
    );
    this.name = "ConversationNotFoundError";
  }
}

export class NotConversationMemberError extends ProducerError {
  constructor(userId: string, conversationId: string) {
    super(
      ProducerErrorCode.NOT_CONVERSATION_MEMBER,
      403,
      `User ${userId} is not a member of conversation ${conversationId}`,
      { userId, conversationId },
    );
    this.name = "NotConversationMemberError";
  }
}

// Rate Limiting (429)

export class RateLimitExceededError extends ProducerError {
  constructor(limit: number, window: string, retryAfter: number) {
    super(
      ProducerErrorCode.RATE_LIMIT_EXCEEDED,
      429,
      `Rate limit exceeded: ${limit} requests per ${window}. Retry after ${retryAfter}s`,
      { limit, window, retryAfter },
    );
    this.name = "RateLimitExceededError";
  }
}

// State Validation (409)

export class ConversationInactiveError extends ProducerError {
  constructor(conversationId: string) {
    super(
      ProducerErrorCode.CONVERSATION_INACTIVE,
      409,
      `Conversation is inactive: ${conversationId}`,
      { conversationId },
    );
    this.name = "ConversationInactiveError";
  }
}

export class UserBlockedError extends ProducerError {
  constructor(userId: string, blockedBy: string) {
    super(
      ProducerErrorCode.USER_BLOCKED,
      409,
      `User ${userId} is blocked by ${blockedBy}`,
      { userId, blockedBy },
    );
    this.name = "UserBlockedError";
  }
}

// Internal Errors (500)

export class EnqueueFailedError extends ProducerError {
  constructor(reason: string, originalError?: Error) {
    super(
      ProducerErrorCode.ENQUEUE_FAILED,
      500,
      `Failed to enqueue message: ${reason}`,
      { originalError: originalError?.message },
    );
    this.name = "EnqueueFailedError";
  }
}
