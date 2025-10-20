import { Request, Response, NextFunction } from "express";
import { ValidationError } from "class-validator";

/**
 * Request Validation Middleware
 *
 * Provides schema validation, payload size caps, content type restrictions,
 * and security checks for all public endpoints.
 *
 * See: docs/operations/validation.md for validation rules and error handling
 */

/**
 * Allowed file types for uploads
 */
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
];

export const ALLOWED_ATTACHMENT_TYPES = [
  ...ALLOWED_IMAGE_TYPES,
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
];

/**
 * Size limits (bytes)
 */
export const SIZE_LIMITS = {
  JSON_BODY: 10 * 1024 * 1024, // 10MB for JSON
  IMAGE_UPLOAD: 10 * 1024 * 1024, // 10MB for images
  FILE_ATTACHMENT: 25 * 1024 * 1024, // 25MB for file attachments
  MESSAGE_CONTENT: 10000, // 10k characters for message text
  CONVERSATION_TITLE: 200, // 200 characters
  CONVERSATION_DESCRIPTION: 1000, // 1000 characters
};

/**
 * Validation error response
 */
function sendValidationError(
  res: Response,
  message: string,
  details?: any,
): Response {
  return res.status(400).json({
    success: false,
    error: "Validation Error",
    message,
    details,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Validate userId parameter (required for most endpoints)
 */
export function validateUserId(location: "body" | "query" | "both" = "both") {
  return (req: Request, res: Response, next: NextFunction): void => {
    let userId: string | undefined;

    if (location === "body" || location === "both") {
      userId = req.body?.userId;
    }

    if (!userId && (location === "query" || location === "both")) {
      userId = req.query?.userId as string;
    }

    if (!userId) {
      sendValidationError(res, "userId is required", {
        parameter: "userId",
        location: location === "both" ? "body or query" : location,
        received: undefined,
      });
      return;
    }

    // Validate userId format (must be non-empty string)
    if (typeof userId !== "string" || userId.trim().length === 0) {
      sendValidationError(res, "userId must be a non-empty string", {
        parameter: "userId",
        received: userId,
      });
      return;
    }

    // Reasonable length check (prevent abuse)
    if (userId.length > 200) {
      sendValidationError(res, "userId is too long (max 200 characters)", {
        parameter: "userId",
        received: `${userId.substring(0, 50)}...`,
      });
      return;
    }

    next();
  };
}

/**
 * Validate conversationId parameter
 */
export function validateConversationId(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const conversationId =
    req.params.conversationId ||
    req.body?.conversationId ||
    req.query?.conversationId;

  if (!conversationId) {
    sendValidationError(res, "conversationId is required");
    return;
  }

  if (
    typeof conversationId !== "string" ||
    conversationId.trim().length === 0
  ) {
    sendValidationError(res, "conversationId must be a non-empty string");
    return;
  }

  next();
}

/**
 * Validate message content
 */
export function validateMessageContent(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const { content } = req.body;

  if (!content) {
    sendValidationError(res, "Message content is required");
    return;
  }

  if (typeof content !== "string") {
    sendValidationError(res, "Message content must be a string");
    return;
  }

  if (content.trim().length === 0) {
    sendValidationError(res, "Message content cannot be empty");
    return;
  }

  if (content.length > SIZE_LIMITS.MESSAGE_CONTENT) {
    sendValidationError(
      res,
      `Message content is too long (max ${SIZE_LIMITS.MESSAGE_CONTENT} characters)`,
      {
        maxLength: SIZE_LIMITS.MESSAGE_CONTENT,
        actualLength: content.length,
      },
    );
    return;
  }

  next();
}

/**
 * Validate conversation creation payload
 */
export function validateConversationCreate(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const { type, participantIds, title, description } = req.body;

  // Validate type
  if (!type || !["DIRECT", "GROUP"].includes(type)) {
    sendValidationError(res, 'type must be either "DIRECT" or "GROUP"', {
      allowed: ["DIRECT", "GROUP"],
      received: type,
    });
    return;
  }

  // Validate participantIds
  if (!participantIds || !Array.isArray(participantIds)) {
    sendValidationError(res, "participantIds must be an array");
    return;
  }

  if (participantIds.length === 0) {
    sendValidationError(res, "participantIds cannot be empty");
    return;
  }

  if (participantIds.length > 100) {
    sendValidationError(res, "Too many participants (max 100)", {
      maxParticipants: 100,
      received: participantIds.length,
    });
    return;
  }

  // Validate each participantId
  for (const id of participantIds) {
    if (typeof id !== "string" || id.trim().length === 0) {
      sendValidationError(res, "All participantIds must be non-empty strings", {
        invalid: id,
      });
      return;
    }
  }

  // Validate title (optional, but if provided must meet constraints)
  if (title !== undefined) {
    if (typeof title !== "string") {
      sendValidationError(res, "title must be a string");
      return;
    }
    if (title.length > SIZE_LIMITS.CONVERSATION_TITLE) {
      sendValidationError(
        res,
        `title is too long (max ${SIZE_LIMITS.CONVERSATION_TITLE} characters)`,
      );
      return;
    }
  }

  // Validate description (optional)
  if (description !== undefined) {
    if (typeof description !== "string") {
      sendValidationError(res, "description must be a string");
      return;
    }
    if (description.length > SIZE_LIMITS.CONVERSATION_DESCRIPTION) {
      sendValidationError(
        res,
        `description is too long (max ${SIZE_LIMITS.CONVERSATION_DESCRIPTION} characters)`,
      );
      return;
    }
  }

  next();
}

/**
 * Validate file upload
 */
export function validateFileUpload(allowedTypes: string[], maxSize: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const file = (req as any).file;

    if (!file) {
      sendValidationError(res, "No file uploaded");
      return;
    }

    // Validate MIME type
    if (!allowedTypes.includes(file.mimetype)) {
      sendValidationError(res, "Invalid file type", {
        allowed: allowedTypes,
        received: file.mimetype,
      });
      return;
    }

    // Validate file size
    if (file.size > maxSize) {
      sendValidationError(res, "File is too large", {
        maxSize: `${Math.round(maxSize / 1024 / 1024)}MB`,
        actualSize: `${Math.round(file.size / 1024 / 1024)}MB`,
      });
      return;
    }

    next();
  };
}

/**
 * Validate pagination parameters
 */
export function validatePagination(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const { limit, cursor } = req.query;

  // Validate limit
  if (limit !== undefined) {
    const limitNum = parseInt(limit as string, 10);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      sendValidationError(res, "limit must be between 1 and 100", {
        received: limit,
        allowed: "1-100",
      });
      return;
    }
  }

  // Cursor can be any string (opaque pagination token)
  if (cursor !== undefined && typeof cursor !== "string") {
    sendValidationError(res, "cursor must be a string");
    return;
  }

  next();
}

/**
 * Validate array of message IDs
 */
export function validateMessageIds(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const { messageIds } = req.body;

  if (!messageIds || !Array.isArray(messageIds)) {
    sendValidationError(res, "messageIds must be an array");
    return;
  }

  if (messageIds.length === 0) {
    sendValidationError(res, "messageIds cannot be empty");
    return;
  }

  if (messageIds.length > 100) {
    sendValidationError(res, "Too many message IDs (max 100)", {
      max: 100,
      received: messageIds.length,
    });
    return;
  }

  // Validate each ID
  for (const id of messageIds) {
    if (typeof id !== "string" || id.trim().length === 0) {
      sendValidationError(res, "All messageIds must be non-empty strings", {
        invalid: id,
      });
      return;
    }
  }

  next();
}

/**
 * Sanitize input strings (prevent XSS)
 */
export function sanitizeInput(input: string): string {
  if (typeof input !== "string") return input;

  return input
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
}

/**
 * Validate and sanitize search query
 */
export function validateSearchQuery(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const { query } = req.query;

  if (!query) {
    sendValidationError(res, "search query is required");
    return;
  }

  if (typeof query !== "string") {
    sendValidationError(res, "query must be a string");
    return;
  }

  if (query.trim().length === 0) {
    sendValidationError(res, "query cannot be empty");
    return;
  }

  if (query.length > 200) {
    sendValidationError(res, "query is too long (max 200 characters)");
    return;
  }

  // Sanitize query to prevent injection attacks
  req.query.query = sanitizeInput(query);

  next();
}

/**
 * Validate ID card verification payload
 */
export function validateIdCardVerification(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const { collegeName, studentIdNumber, graduationYear } = req.body;

  if (
    !collegeName ||
    typeof collegeName !== "string" ||
    collegeName.trim().length === 0
  ) {
    sendValidationError(
      res,
      "collegeName is required and must be a non-empty string",
    );
    return;
  }

  if (collegeName.length > 200) {
    sendValidationError(res, "collegeName is too long (max 200 characters)");
    return;
  }

  if (
    !studentIdNumber ||
    typeof studentIdNumber !== "string" ||
    studentIdNumber.trim().length === 0
  ) {
    sendValidationError(
      res,
      "studentIdNumber is required and must be a non-empty string",
    );
    return;
  }

  if (studentIdNumber.length > 100) {
    sendValidationError(
      res,
      "studentIdNumber is too long (max 100 characters)",
    );
    return;
  }

  // graduationYear is optional
  if (graduationYear !== undefined) {
    const year = parseInt(graduationYear, 10);
    const currentYear = new Date().getFullYear();
    if (isNaN(year) || year < 1900 || year > currentYear + 10) {
      sendValidationError(res, "graduationYear must be a valid year", {
        allowed: `1900-${currentYear + 10}`,
        received: graduationYear,
      });
      return;
    }
  }

  next();
}
