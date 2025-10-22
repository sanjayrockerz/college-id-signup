import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  UseFilters,
} from "@nestjs/common";
import { MessageProducerService } from "../services/message-producer.service";
import { ProducerError } from "../errors/producer.errors";
import { ProducerErrorFilter } from "../filters/producer-error.filter";

/**
 * Message Producer Controller (Hot Path)
 *
 * DESIGN PRINCIPLES:
 * - Fast validation and enqueue
 * - Return "pending" immediately
 * - No synchronous DB writes
 * - Clear error responses
 *
 * ENDPOINTS:
 * - POST /messages/send - Send message (validate + enqueue)
 *
 * RESPONSE:
 * {
 *   messageId: string,
 *   correlationId: string,
 *   state: "pending",
 *   acceptedAt: ISO timestamp,
 *   guidance: {
 *     eventualConsistency: "Message will be delivered asynchronously. Listen for state transitions via WebSocket.",
 *     stateTransitions: "pending → sent → delivered → read",
 *     pollingEndpoint: "/messages/{messageId}/status"
 *   }
 * }
 *
 * ERROR RESPONSE:
 * {
 *   error: {
 *     code: "INVALID_SCHEMA",
 *     message: "Missing required field: conversationId",
 *     details: { field: "conversationId" }
 *   }
 * }
 */

@Controller("messages")
@UseFilters(ProducerErrorFilter)
export class MessageProducerController {
  constructor(private readonly producer: MessageProducerService) {}

  /**
   * Send message (fast producer)
   *
   * POST /messages/send
   *
   * Request:
   * {
   *   conversationId: string,
   *   senderId: string,
   *   content: string,
   *   contentType?: "text" | "image" | "file" | "audio" | "video" | "location",
   *   clientMessageId?: string,
   *   recipientIds?: string[],
   *   metadata?: {
   *     replyToId?: string,
   *     threadId?: string,
   *     attachmentIds?: string[]
   *   }
   * }
   *
   * Response: 202 Accepted
   * {
   *   messageId: string,
   *   correlationId: string,
   *   state: "pending",
   *   acceptedAt: ISO timestamp,
   *   idempotencyKey: string,
   *   guidance: {
   *     eventualConsistency: "...",
   *     stateTransitions: "...",
   *     pollingEndpoint: "..."
   *   }
   * }
   */
  @Post("send")
  @HttpCode(HttpStatus.ACCEPTED) // 202 Accepted (async processing)
  async sendMessage(@Body() body: any, @Request() req: any) {
    try {
      // Extract senderId from authenticated user
      // TODO: Add authentication guard
      const senderId = body.senderId || req.user?.id;

      const request = {
        ...body,
        senderId,
      };

      const ack = await this.producer.sendMessage(request);

      // Return with guidance on eventual consistency
      return {
        messageId: ack.messageId,
        correlationId: ack.correlationId,
        state: ack.state,
        acceptedAt: ack.acceptedAt,
        idempotencyKey: ack.idempotencyKey,
        guidance: {
          eventualConsistency:
            "Message will be delivered asynchronously. Listen for state transitions via WebSocket.",
          stateTransitions: "pending → sent → delivered → read",
          pollingEndpoint: `/messages/${ack.messageId}/status`,
          websocketEvent: "message.state.changed",
        },
      };
    } catch (error) {
      if (error instanceof ProducerError) {
        // Return structured error response
        throw error; // Let NestJS exception filter handle it
      }

      throw error;
    }
  }
}
