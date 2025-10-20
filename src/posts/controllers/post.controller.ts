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
} from "@nestjs/common";
import { PostService } from "../services/post.service";
import {
  CreatePostDto,
  UpdatePostDto,
  PostResponseDto,
} from "../dtos/post.dto";

@Controller("posts")
export class PostController {
  constructor(private readonly postService: PostService) {}

  @Post()
  async createPost(
    @Body() createPostDto: CreatePostDto & { userId: string },
    @Request() req: any,
  ): Promise<PostResponseDto> {
    // userId provided by upstream service (see docs/scope/no-auth-policy.md)
    const userId = createPostDto.userId;

    if (!userId) {
      throw new BadRequestException("userId is required in request body");
    }

    return this.postService.createPost(userId, createPostDto);
  }

  @Get(":id")
  async getPost(
    @Param("id") postId: string,
    @Request() req: any,
    @Query("userId") userId?: string,
  ): Promise<PostResponseDto> {
    // userId is optional for read operations
    const post = await this.postService.getPostById(postId, userId);

    if (!post) {
      throw new BadRequestException("Post not found");
    }

    return post;
  }

  @Put(":id")
  async updatePost(
    @Param("id") postId: string,
    @Body() updatePostDto: UpdatePostDto & { userId: string },
    @Request() req: any,
  ): Promise<PostResponseDto> {
    // userId provided by upstream service (see docs/scope/no-auth-policy.md)
    const userId = updatePostDto.userId;

    if (!userId) {
      throw new BadRequestException("userId is required in request body");
    }

    return this.postService.updatePost(postId, userId, updatePostDto);
  }

  @Delete(":id")
  // @UseGuards(AuthGuard)
  async deletePost(
    @Param("id") postId: string,
    @Request() req: any,
  ): Promise<{ message: string }> {
    const userId = req.user?.id || "temp-user-id";
    await this.postService.deletePost(postId, userId);
    return { message: "Post deleted successfully" };
  }

  @Post(":id/view")
  // @UseGuards(AuthGuard)
  async viewPost(
    @Param("id") postId: string,
    @Request() req: any,
  ): Promise<{ message: string }> {
    const userId = req.user?.id || "temp-user-id";
    await this.postService.incrementViewCount(postId, userId);
    return { message: "View recorded" };
  }

  @Get("user/:userId")
  async getUserPosts(
    @Param("userId") userId: string,
    @Request() req: any,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ): Promise<PostResponseDto[]> {
    const requesterId = req.user?.id;
    const parsedLimit = limit ? parseInt(limit, 10) : 10;

    return this.postService.getUserPosts(
      userId,
      requesterId,
      parsedLimit,
      cursor,
    );
  }
}
