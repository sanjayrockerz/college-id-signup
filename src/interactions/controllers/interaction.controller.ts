import { Controller, Post, Delete, Get, Body, Param, Query, Request } from '@nestjs/common';
import { InteractionService } from '../services/interaction.service';
import { CreateInteractionDto } from '../dtos/interaction.dto';

@Controller('interactions')
export class InteractionController {
  constructor(private readonly interactionService: InteractionService) {}

  @Post()
  async createInteraction(@Body() createInteractionDto: CreateInteractionDto, @Request() req: any) {
    const userId = req.user?.id || 'temp-user-id';
    return this.interactionService.createInteraction(userId, createInteractionDto);
  }

  @Delete(':postId/:type')
  async removeInteraction(
    @Param('postId') postId: string,
    @Param('type') type: string,
    @Request() req: any
  ) {
    const userId = req.user?.id || 'temp-user-id';
    await this.interactionService.removeInteraction(userId, postId, type);
    return { message: 'Interaction removed successfully' };
  }

  @Get('post/:postId')
  async getPostInteractions(@Param('postId') postId: string, @Query('type') type?: string) {
    return this.interactionService.getPostInteractions(postId, type);
  }

  @Get('user')
  async getUserInteractions(@Request() req: any, @Query('type') type?: string) {
    const userId = req.user?.id || 'temp-user-id';
    return this.interactionService.getUserInteractions(userId, type);
  }

  @Post('coolness/:postId')
  async rateCoolness(
    @Param('postId') postId: string,
    @Body() body: { rating: number },
    @Request() req: any
  ) {
    const userId = req.user?.id || 'temp-user-id';
    return this.interactionService.rateCoolness(userId, postId, body.rating);
  }

  @Get('coolness/:postId')
  async getPostCoolnessRating(@Param('postId') postId: string) {
    const rating = await this.interactionService.getPostCoolnessRating(postId);
    return { rating };
  }
}
