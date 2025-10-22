import {
  InvalidSchemaError,
  MissingRequiredFieldError,
  InvalidFieldTypeError,
  FieldTooLongError,
  InvalidRecipientError,
} from "../errors/producer.errors";

/**
 * Message Producer Schema Validator
 *
 * Fast, synchronous validation on the hot path:
 * - Required field checks
 * - Type validation
 * - Length limits
 * - Recipient validation
 *
 * Throws ProducerError with clear rejection reasons
 */

export interface SendMessageRequest {
  conversationId: string;
  senderId: string;
  content: string;
  contentType?: string;
  clientMessageId?: string;
  recipientIds?: string[];
  metadata?: {
    replyToId?: string;
    threadId?: string;
    attachmentIds?: string[];
  };
}

export class MessageProducerValidator {
  private static readonly MAX_CONTENT_LENGTH = 10000; // 10KB text
  private static readonly MAX_RECIPIENT_COUNT = 1000; // Group chat limit
  private static readonly VALID_CONTENT_TYPES = [
    "text",
    "image",
    "file",
    "audio",
    "video",
    "location",
  ];

  /**
   * Validate send message request
   * Throws ProducerError on validation failure
   */
  static validateSendMessage(request: any): SendMessageRequest {
    // Required fields
    this.requireField(request, "conversationId");
    this.requireField(request, "senderId");
    this.requireField(request, "content");

    // Type validation
    this.requireString(request, "conversationId");
    this.requireString(request, "senderId");
    this.requireString(request, "content");

    // Length limits
    this.validateLength(request.content, "content", this.MAX_CONTENT_LENGTH);

    // Content type validation
    const contentType = request.contentType || "text";
    if (!this.VALID_CONTENT_TYPES.includes(contentType)) {
      throw new InvalidSchemaError(
        `Invalid contentType: ${contentType}. Must be one of: ${this.VALID_CONTENT_TYPES.join(", ")}`,
        { contentType, validTypes: this.VALID_CONTENT_TYPES },
      );
    }

    // Optional clientMessageId
    if (request.clientMessageId !== undefined) {
      this.requireString(request, "clientMessageId");
      this.validateLength(request.clientMessageId, "clientMessageId", 255);
    }

    // Recipient validation
    const recipientIds = request.recipientIds || [];
    if (!Array.isArray(recipientIds)) {
      throw new InvalidFieldTypeError(
        "recipientIds",
        "array",
        typeof recipientIds,
      );
    }

    if (recipientIds.length > this.MAX_RECIPIENT_COUNT) {
      throw new InvalidSchemaError(
        `Too many recipients: ${recipientIds.length} > ${this.MAX_RECIPIENT_COUNT}`,
        { count: recipientIds.length, max: this.MAX_RECIPIENT_COUNT },
      );
    }

    // Validate each recipient ID
    for (const recipientId of recipientIds) {
      if (typeof recipientId !== "string" || recipientId.length === 0) {
        throw new InvalidRecipientError(
          recipientId,
          "Recipient ID must be a non-empty string",
        );
      }
    }

    // Metadata validation
    if (request.metadata !== undefined) {
      if (typeof request.metadata !== "object" || request.metadata === null) {
        throw new InvalidFieldTypeError(
          "metadata",
          "object",
          typeof request.metadata,
        );
      }

      // Validate metadata fields
      const { replyToId, threadId, attachmentIds } = request.metadata;

      if (replyToId !== undefined) {
        if (typeof replyToId !== "string") {
          throw new InvalidFieldTypeError(
            "metadata.replyToId",
            "string",
            typeof replyToId,
          );
        }
      }

      if (threadId !== undefined) {
        if (typeof threadId !== "string") {
          throw new InvalidFieldTypeError(
            "metadata.threadId",
            "string",
            typeof threadId,
          );
        }
      }

      if (attachmentIds !== undefined) {
        if (!Array.isArray(attachmentIds)) {
          throw new InvalidFieldTypeError(
            "metadata.attachmentIds",
            "array",
            typeof attachmentIds,
          );
        }

        for (const attachmentId of attachmentIds) {
          if (typeof attachmentId !== "string") {
            throw new InvalidSchemaError("All attachment IDs must be strings", {
              invalidId: attachmentId,
            });
          }
        }
      }
    }

    return {
      conversationId: request.conversationId,
      senderId: request.senderId,
      content: request.content,
      contentType,
      clientMessageId: request.clientMessageId,
      recipientIds,
      metadata: request.metadata,
    };
  }

  /**
   * Require field exists
   */
  private static requireField(obj: any, field: string): void {
    if (!(field in obj) || obj[field] === undefined || obj[field] === null) {
      throw new MissingRequiredFieldError(field);
    }
  }

  /**
   * Require string type
   */
  private static requireString(obj: any, field: string): void {
    if (typeof obj[field] !== "string") {
      throw new InvalidFieldTypeError(field, "string", typeof obj[field]);
    }
  }

  /**
   * Validate string length
   */
  private static validateLength(
    value: string,
    field: string,
    maxLength: number,
  ): void {
    if (value.length > maxLength) {
      throw new FieldTooLongError(field, maxLength, value.length);
    }
  }
}
