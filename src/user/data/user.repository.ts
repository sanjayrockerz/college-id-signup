import { Injectable } from "@nestjs/common";
import { getPrismaClient } from "../../config/database";

export interface UpdateUserDto {
  firstName?: string;
  lastName?: string;
  bio?: string;
  profileImageUrl?: string;
  allowDirectMessages?: boolean;
  showOnlineStatus?: boolean;
  profileVisibility?:
    | "PUBLIC"
    | "CONNECTIONS_ONLY"
    | "CLOSE_FRIENDS_ONLY"
    | "PRIVATE";
}

export interface UserResponseDto {
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

@Injectable()
export class UserRepository {
  private get prisma() {
    return getPrismaClient();
  }

  async findById(id: string): Promise<any | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  async findByEmail(email: string): Promise<any | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async findByUsername(username: string): Promise<any | null> {
    return this.prisma.user.findUnique({
      where: { username },
    });
  }

  async create(userData: any): Promise<any> {
    const now = new Date();
    return this.prisma.user.create({
      data: {
        anonymousPostsToday: 0,
        weeklyPushesUsed: 0,
        lastAnonymousPostDate: now,
        lastWeeklyReset: now,
        allowDirectMessages: true,
        showOnlineStatus: true,
        profileVisibility: "PUBLIC",
        ...userData,
      },
    });
  }

  async update(id: string, updateData: UpdateUserDto): Promise<any> {
    return this.prisma.user.update({
      where: { id },
      data: {
        ...updateData,
      },
    });
  }

  async incrementAnonymousPostCount(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        anonymousPostsToday: { increment: 1 },
        lastAnonymousPostDate: new Date(),
      },
    });
  }

  async resetAnonymousPostCount(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        anonymousPostsToday: 0,
        lastAnonymousPostDate: new Date(),
      },
    });
  }

  async incrementWeeklyPushCount(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        weeklyPushesUsed: { increment: 1 },
      },
    });
  }

  async resetWeeklyPushCount(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        weeklyPushesUsed: 0,
        lastWeeklyReset: new Date(),
      },
    });
  }
}
