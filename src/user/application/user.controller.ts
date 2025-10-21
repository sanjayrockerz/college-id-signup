import { Controller, Get, Put, Body, Param, Request } from "@nestjs/common";
import { UserService } from "./user.service";
import { UpdateUserDto } from "../data/user.repository";

interface UserResponseDto {
  id: string;
  email: string;
  username: string;
  firstName?: string;
  lastName?: string;
  bio?: string;
  profileImageUrl?: string;
  profileVisibility: string;
  createdAt: Date;
  stats: {
    anonymousPostsToday: number;
    weeklyPushesUsed: number;
  };
}

@Controller("users")
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get("me")
  async getCurrentUser(@Request() req: any): Promise<UserResponseDto> {
    const userId = req.user?.id || "temp-user-id";
    return this.userService.getUserById(userId);
  }

  @Get(":id")
  async getUserById(@Param("id") id: string): Promise<UserResponseDto> {
    return this.userService.getUserById(id);
  }

  @Get("username/:username")
  async getUserByUsername(
    @Param("username") username: string,
  ): Promise<UserResponseDto> {
    return this.userService.getUserByUsername(username);
  }

  @Put("me")
  async updateCurrentUser(
    @Body() updateUserDto: UpdateUserDto,
    @Request() req: any,
  ): Promise<UserResponseDto> {
    const userId = req.user?.id || "temp-user-id";
    return this.userService.updateUser(userId, updateUserDto);
  }

  @Get("me/limits")
  async getUserLimits(
    @Request() req: any,
  ): Promise<{ canPostAnonymous: boolean; canPush: boolean }> {
    const userId = req.user?.id || "temp-user-id";
    const canPostAnonymous =
      await this.userService.checkAnonymousPostLimit(userId);
    const canPush = await this.userService.checkWeeklyPushLimit(userId);

    return {
      canPostAnonymous,
      canPush,
    };
  }
}
