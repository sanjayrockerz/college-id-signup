import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { PostService } from '../services/post.service';
import { CreatePostDto, UpdatePostDto, PostResponseDto } from '../dtos/post.dto';

@Controller('posts')
export class PostController {
  constructor(private readonly postService: PostService) {}

  @Post()
  // @UseGuards(AuthGuard) // TODO: Implement authentication
  async createPost(
    @Body() createPostDto: CreatePostDto,
    @Request() req: any // TODO: Type with proper user interface
  ): Promise<PostResponseDto> {
    const userId = req.user?.id || 'temp-user-id'; // TODO: Get from authenticated user
    return this.postService.createPost(userId, createPostDto);
  }

  @Get(':id')
  async getPost(
    @Param('id') postId: string,
    @Request() req: any
  ): Promise<PostResponseDto> {
    const userId = req.user?.id;
    const post = await this.postService.getPostById(postId, userId);
    
    if (!post) {
      throw new BadRequestException('Post not found');
    }

    return post;
  }

  @Put(':id')
  // @UseGuards(AuthGuard)
  async updatePost(
    @Param('id') postId: string,
    @Body() updatePostDto: UpdatePostDto,
    @Request() req: any
  ): Promise<PostResponseDto> {
    const userId = req.user?.id || 'temp-user-id';
    return this.postService.updatePost(postId, userId, updatePostDto);
  }

  @Delete(':id')
  // @UseGuards(AuthGuard)
  async deletePost(
    @Param('id') postId: string,
    @Request() req: any
  ): Promise<{ message: string }> {
    const userId = req.user?.id || 'temp-user-id';
    await this.postService.deletePost(postId, userId);
    return { message: 'Post deleted successfully' };
  }

  @Post(':id/view')
  // @UseGuards(AuthGuard)
  async viewPost(
    @Param('id') postId: string,
    @Request() req: any
  ): Promise<{ message: string }> {
    const userId = req.user?.id || 'temp-user-id';
    await this.postService.incrementViewCount(postId, userId);
    return { message: 'View recorded' };
  }

  @Get('user/:userId')
  async getUserPosts(
    @Param('userId') userId: string,
    @Request() req: any,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string
  ): Promise<PostResponseDto[]> {
    const requesterId = req.user?.id;
    const parsedLimit = limit ? parseInt(limit, 10) : 10;
    
    return this.postService.getUserPosts(userId, requesterId, parsedLimit, cursor);
  }
}
