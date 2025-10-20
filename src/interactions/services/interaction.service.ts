import { Injectable, BadRequestException } from "@nestjs/common";
import { CreateInteractionDto } from "../dtos/interaction.dto";
import { InteractionRepository } from "../repositories/interaction.repository";

@Injectable()
export class InteractionService {
  constructor(private readonly interactionRepository: InteractionRepository) {}

  async createInteraction(
    userId: string,
    createInteractionDto: CreateInteractionDto,
  ): Promise<any> {
    const { type, postId } = createInteractionDto;

    // Validate interaction type
    const validTypes = ["LIKE", "COMMENT", "SHARE", "VIEW"];
    if (!validTypes.includes(type)) {
      throw new BadRequestException("Invalid interaction type");
    }

    // TODO: Check if post exists
    // TODO: Check if user already has this interaction type on this post
    // TODO: Implement with actual repository

    return {
      id: "temp-interaction-id",
      type,
      createdAt: new Date(),
      userId,
      postId,
    };
  }

  async removeInteraction(
    userId: string,
    postId: string,
    type: string,
  ): Promise<void> {
    // TODO: Implement with actual repository
  }

  async getPostInteractions(postId: string, type?: string): Promise<any[]> {
    // TODO: Implement with actual repository
    return [];
  }

  async getUserInteractions(userId: string, type?: string): Promise<any[]> {
    // TODO: Implement with actual repository
    return [];
  }

  async rateCoolness(
    userId: string,
    postId: string,
    rating: number,
  ): Promise<any> {
    if (rating < 1 || rating > 5) {
      throw new BadRequestException("Coolness rating must be between 1 and 5");
    }

    // TODO: Check if user already rated this post
    // TODO: Implement with actual repository

    return {
      id: "temp-rating-id",
      rating,
      createdAt: new Date(),
      userId,
      postId,
    };
  }

  async getPostCoolnessRating(postId: string): Promise<number> {
    // TODO: Calculate average coolness rating
    // TODO: Implement with actual repository
    return 0;
  }
}
