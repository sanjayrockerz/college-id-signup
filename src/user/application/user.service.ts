import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { UserRepository, UpdateUserDto, UserResponseDto } from '../data/user.repository';

@Injectable()
export class UserService {
  constructor(private readonly userRepository: UserRepository) {}

  async getUserById(id: string): Promise<UserResponseDto | null> {
    const user = await this.userRepository.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.mapToResponseDto(user);
  }

  async getUserByEmail(email: string): Promise<UserResponseDto | null> {
    const user = await this.userRepository.findByEmail(email);
    return user ? this.mapToResponseDto(user) : null;
  }

  async getUserByUsername(username: string): Promise<UserResponseDto | null> {
    const user = await this.userRepository.findByUsername(username);
    return user ? this.mapToResponseDto(user) : null;
  }

  async updateUser(id: string, updateUserDto: UpdateUserDto): Promise<UserResponseDto> {
    const existingUser = await this.userRepository.findById(id);
    if (!existingUser) {
      throw new NotFoundException('User not found');
    }

    const updatedUser = await this.userRepository.update(id, updateUserDto);
    return this.mapToResponseDto(updatedUser);
  }

  async checkAnonymousPostLimit(userId: string): Promise<boolean> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if it's a new day and reset count if needed
    const today = new Date();
    const lastPostDate = user.lastAnonymousPostDate;
    
    if (!lastPostDate || this.isDifferentDay(today, lastPostDate)) {
      await this.userRepository.resetAnonymousPostCount(userId);
      return true; // Can post
    }

    return user.anonymousPostsToday < 2;
  }

  async incrementAnonymousPostCount(userId: string): Promise<void> {
    await this.userRepository.incrementAnonymousPostCount(userId);
  }

  async checkWeeklyPushLimit(userId: string): Promise<boolean> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if it's a new week and reset count if needed
    const today = new Date();
    const lastResetDate = user.lastWeeklyReset;
    
    if (this.isNewWeek(today, lastResetDate)) {
      await this.userRepository.resetWeeklyPushCount(userId);
      return true; // Can push
    }

    return user.weeklyPushesUsed < 5; // Assuming 5 pushes per week limit
  }

  async incrementWeeklyPushCount(userId: string): Promise<void> {
    await this.userRepository.incrementWeeklyPushCount(userId);
  }

  private mapToResponseDto(user: any): UserResponseDto {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      bio: user.bio,
      profileImageUrl: user.profileImageUrl,
      isVerified: user.isVerified,
      verifiedCollegeId: user.verifiedCollegeId,
      collegeName: user.collegeName,
      graduationYear: user.graduationYear,
      profileVisibility: user.profileVisibility,
      createdAt: user.createdAt,
      stats: {
        anonymousPostsToday: user.anonymousPostsToday || 0,
        weeklyPushesUsed: user.weeklyPushesUsed || 0,
      },
    };
  }

  private isDifferentDay(date1: Date, date2: Date): boolean {
    return date1.toDateString() !== date2.toDateString();
  }

  private isNewWeek(currentDate: Date, lastResetDate: Date): boolean {
    const weekInMs = 7 * 24 * 60 * 60 * 1000;
    return currentDate.getTime() - lastResetDate.getTime() > weekInMs;
  }

  async verifyCollege(userId: string, collegeData: {
    verifiedCollegeId: string;
    collegeName: string;
    studentIdNumber: string;
    graduationYear: number;
  }): Promise<UserResponseDto> {
    const updateData = {
      ...collegeData,
      isVerified: true,
    };

    return this.updateUser(userId, updateData);
  }
}