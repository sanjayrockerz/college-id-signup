import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../infra/prisma/prisma.service";
import sharp from "sharp";
import {
  MobileUserDto,
  MobileFeedDto,
  MobilePostDto,
  MobileConnectionDto,
} from "../dtos/mobile-optimized.dto";

export interface MobileOptimizationOptions {
  quality: "low" | "medium" | "high";
  dataUsage: "low" | "normal" | "high";
  networkQuality: "poor" | "fair" | "good" | "excellent";
  generateThumbnail: boolean;
  compressForNetwork: boolean;
}

export interface OptimizedImageResult {
  optimized: Buffer;
  thumbnail?: Buffer;
  originalSize: number;
  optimizedSize: number;
  compressionRatio: number;
  estimatedLoadTime: number; // milliseconds
}

export interface MobilePaginationOptions {
  limit: number;
  cursor?: string;
  dataUsage: "low" | "normal" | "high";
  includeImages: boolean;
  includeMetadata: boolean;
}

@Injectable()
export class MobileOptimizationService {
  private readonly logger = new Logger(MobileOptimizationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Optimize images for mobile consumption based on network quality and data usage preferences
   */
  async optimizeImageForMobile(
    imageBuffer: Buffer,
    options: MobileOptimizationOptions,
  ): Promise<OptimizedImageResult> {
    const startTime = Date.now();
    const originalSize = imageBuffer.length;

    // Quality settings optimized for mobile networks
    const qualitySettings = {
      low: {
        jpeg: 50,
        webp: 40,
        maxWidth: 600,
        thumbnailSize: 100,
        effort: 1, // Fast processing for low-end devices
      },
      medium: {
        jpeg: 70,
        webp: 60,
        maxWidth: 1000,
        thumbnailSize: 150,
        effort: 3,
      },
      high: {
        jpeg: 85,
        webp: 75,
        maxWidth: 1600,
        thumbnailSize: 200,
        effort: 4,
      },
    };

    const settings = qualitySettings[options.quality];

    try {
      // Main optimized image with progressive loading support
      const optimizedPipeline = sharp(imageBuffer).resize(
        settings.maxWidth,
        null,
        {
          withoutEnlargement: true,
          fastShrinkOnLoad: true,
        },
      );

      // Choose format based on browser support and compression efficiency
      const optimized = await optimizedPipeline
        .webp({
          quality: settings.webp,
          effort: settings.effort,
        })
        .toBuffer();

      // Generate thumbnail for mobile previews and list views
      let thumbnail: Buffer | undefined;
      if (options.generateThumbnail) {
        thumbnail = await sharp(imageBuffer)
          .resize(settings.thumbnailSize, settings.thumbnailSize, {
            fit: "cover",
            fastShrinkOnLoad: true,
            position: "center",
          })
          .webp({
            quality: 40, // Aggressive compression for thumbnails
            effort: 1, // Fast processing
          })
          .toBuffer();
      }

      const optimizedSize = optimized.length;
      const compressionRatio = (originalSize - optimizedSize) / originalSize;
      const processingTime = Date.now() - startTime;

      // Estimate load time based on network quality
      const estimatedLoadTime = this.calculateEstimatedLoadTime(
        optimizedSize,
        options.networkQuality,
      );

      this.logger.log(
        `Mobile image optimization completed: ${originalSize}B -> ${optimizedSize}B ` +
          `(${(compressionRatio * 100).toFixed(1)}% reduction) in ${processingTime}ms`,
      );

      return {
        optimized,
        thumbnail,
        originalSize,
        optimizedSize,
        compressionRatio,
        estimatedLoadTime,
      };
    } catch (error) {
      this.logger.error("Image optimization failed:", error);
      throw new Error("Failed to optimize image for mobile");
    }
  }

  /**
   * Batch process operations with mobile-friendly concurrency limits
   */
  async batchProcessForMobile<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    options: {
      batchSize?: number;
      delayBetweenBatches?: number;
      maxConcurrency?: number;
    } = {},
  ): Promise<R[]> {
    const {
      batchSize = 3, // Conservative batch size for mobile
      delayBetweenBatches = 100, // Battery-friendly delay
      maxConcurrency = 2, // Limit concurrent operations
    } = options;

    const results: R[] = [];

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);

      // Process batch with concurrency limit
      const batchPromises = batch.map(async (item, index) => {
        // Stagger requests to avoid overwhelming mobile connections
        if (index > 0) {
          await new Promise((resolve) => setTimeout(resolve, index * 50));
        }
        return processor(item);
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Battery-friendly delay between batches
      if (i + batchSize < items.length) {
        await new Promise((resolve) =>
          setTimeout(resolve, delayBetweenBatches),
        );
      }
    }

    return results;
  }

  private calculateEstimatedLoadTime(
    sizeBytes: number,
    networkQuality: string,
  ): number {
    // Network speed estimates in bytes per second
    const networkSpeeds = {
      poor: 50 * 1024, // 50 KB/s (2G)
      fair: 200 * 1024, // 200 KB/s (3G)
      good: 1000 * 1024, // 1 MB/s (4G)
      excellent: 5000 * 1024, // 5 MB/s (5G/WiFi)
    };

    const speed = networkSpeeds[networkQuality] || networkSpeeds.fair;
    return Math.ceil((sizeBytes / speed) * 1000); // Convert to milliseconds
  }
  optimizeUserForMobile(user: any): MobileUserDto {
    return {
      id: user.id,
      username: user.username,
      avatar: user.profileImageUrl
        ? this.optimizeImageUrl(user.profileImageUrl, "avatar")
        : undefined,
      isVerified: user.isVerified,
      collegeName: user.collegeName,
    };
  }

  /**
   * Convert full post object to mobile-optimized version
   */
  optimizePostForMobile(post: any, userId?: string): MobilePostDto {
    return {
      id: post.id,
      content: this.truncateContent(post.content, 300), // Limit content for mobile
      images: post.imageUrls?.map((url: string) =>
        this.optimizeImageUrl(url, "post"),
      ),
      isAnonymous: post.isAnonymous,
      timeAgo: this.getTimeAgo(post.createdAt),
      author:
        post.author && !post.isAnonymous
          ? this.optimizeUserForMobile(post.author)
          : undefined,
      stats: {
        likes:
          post._count?.interactions?.filter((i: any) => i.type === "LIKE")
            .length || 0,
        comments:
          post._count?.interactions?.filter((i: any) => i.type === "COMMENT")
            .length || 0,
        shares:
          post._count?.interactions?.filter((i: any) => i.type === "SHARE")
            .length || 0,
        coolness: this.calculateAverageCoolness(post.coolnessRatings || []),
      },
      userInteraction: userId
        ? this.getUserInteractionStatus(post, userId)
        : undefined,
    };
  }

  /**
   * Create mobile-optimized feed response
   */
  optimizeFeedForMobile(
    posts: any[],
    nextCursor?: string,
    totalCount?: number,
    userId?: string,
  ): MobileFeedDto {
    return {
      posts: posts.map((post) => this.optimizePostForMobile(post, userId)),
      nextCursor,
      hasMore: !!nextCursor,
      totalCount,
    };
  }

  /**
   * Optimize connection object for mobile
   */
  optimizeConnectionForMobile(connection: any): MobileConnectionDto {
    return {
      id: connection.id,
      user: this.optimizeUserForMobile(
        connection.receiver || connection.requester,
      ),
      status: connection.status,
      isCloseFriend: connection.isCloseFriend,
      mutualFriends: connection.mutualFriendsCount || 0,
    };
  }

  /**
   * Optimize image URLs for mobile (add compression parameters)
   */
  private optimizeImageUrl(
    originalUrl: string,
    type: "avatar" | "post",
  ): string {
    // Add mobile optimization parameters
    const params =
      type === "avatar"
        ? "w=100&h=100&fit=crop&q=80&f=webp" // Small avatar
        : "w=400&h=400&fit=inside&q=85&f=webp"; // Post image

    return originalUrl.includes("?")
      ? `${originalUrl}&${params}`
      : `${originalUrl}?${params}`;
  }

  /**
   * Truncate content for mobile display
   */
  private truncateContent(content: string, maxLength: number): string {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength).trim() + "...";
  }

  /**
   * Calculate relative time for mobile display
   */
  private getTimeAgo(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "now";
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w`;
    return date.toLocaleDateString();
  }

  /**
   * Calculate average coolness rating
   */
  private calculateAverageCoolness(ratings: any[]): number {
    if (!ratings.length) return 0;
    const sum = ratings.reduce((acc, rating) => acc + rating.rating, 0);
    return Math.round((sum / ratings.length) * 10) / 10; // Round to 1 decimal
  }

  /**
   * Get user's interaction status with a post
   */
  private getUserInteractionStatus(post: any, userId: string): any {
    const userInteractions =
      post.interactions?.filter((i: any) => i.userId === userId) || [];
    const userRating = post.coolnessRatings?.find(
      (r: any) => r.userId === userId,
    );

    return {
      liked: userInteractions.some((i: any) => i.type === "LIKE"),
      shared: userInteractions.some((i: any) => i.type === "SHARE"),
      rated: userRating?.rating,
    };
  }

  /**
   * Create pagination metadata for mobile
   */
  createMobilePagination(items: any[], limit: number, cursor?: string) {
    const hasMore = items.length === limit;
    const nextCursor = hasMore ? items[items.length - 1]?.id : undefined;

    return {
      hasMore,
      nextCursor,
      count: items.length,
    };
  }

  /**
   * Optimize array response for mobile (chunked loading)
   */
  optimizeArrayForMobile<T>(
    items: T[],
    page: number = 1,
    pageSize: number = 20,
  ): {
    items: T[];
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      hasNext: boolean;
      hasPrev: boolean;
    };
  } {
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const paginatedItems = items.slice(start, end);

    return {
      items: paginatedItems,
      pagination: {
        page,
        pageSize,
        total: items.length,
        hasNext: end < items.length,
        hasPrev: page > 1,
      },
    };
  }

  /**
   * Optimize database queries for mobile consumption patterns
   */
  async optimizeQueryForMobile<T>(
    queryBuilder: () => Promise<T[]>,
    options: MobilePaginationOptions,
  ): Promise<{
    data: T[];
    nextCursor?: string;
    hasMore: boolean;
    totalDataSize: number;
    optimizationsApplied: string[];
  }> {
    const optimizationsApplied: string[] = [];
    const startTime = Date.now();

    try {
      // Execute query with mobile-optimized timeout
      const data = await Promise.race([
        queryBuilder(),
        new Promise<T[]>((_, reject) =>
          setTimeout(() => reject(new Error("Query timeout")), 15000),
        ),
      ]);

      optimizationsApplied.push("timeout-protection");

      // Apply mobile-specific data filtering
      let processedData = data;

      // Limit data size for low data usage
      if (options.dataUsage === "low") {
        processedData = processedData.slice(0, Math.min(options.limit, 10));
        optimizationsApplied.push("data-limit-reduction");
      }

      // Calculate pagination
      const hasMore = processedData.length > options.limit;
      if (hasMore) {
        processedData = processedData.slice(0, options.limit);
      }

      // Estimate data size for mobile tracking
      const totalDataSize = this.estimateDataSize(processedData);

      const queryTime = Date.now() - startTime;
      if (queryTime > 1000) {
        this.logger.warn(`Slow mobile query detected: ${queryTime}ms`);
      }

      return {
        data: processedData,
        nextCursor: hasMore ? this.generateCursor(processedData) : undefined,
        hasMore,
        totalDataSize,
        optimizationsApplied,
      };
    } catch (error) {
      this.logger.error("Mobile query optimization failed:", error);
      throw error;
    }
  }

  /**
   * Compress API responses for mobile networks
   */
  compressResponse(
    data: any,
    compressionLevel: "low" | "medium" | "high" = "medium",
  ): any {
    if (!data) return data;

    const compressionStrategies = {
      low: {
        removeNullFields: true,
        truncateArrays: false,
        removeMetadata: false,
      },
      medium: {
        removeNullFields: true,
        truncateArrays: true,
        removeMetadata: true,
      },
      high: {
        removeNullFields: true,
        truncateArrays: true,
        removeMetadata: true,
        abbreviateFieldNames: true,
      },
    };

    const strategy = compressionStrategies[compressionLevel];

    return this.applyCompressionStrategy(data, strategy);
  }

  /**
   * Generate mobile-optimized cache keys
   */
  generateMobileCacheKey(
    baseKey: string,
    mobileContext: {
      userId: string;
      deviceType: string;
      dataUsage: string;
      networkQuality: string;
    },
  ): string {
    return `mobile:${baseKey}:${mobileContext.userId}:${mobileContext.deviceType}:${mobileContext.dataUsage}:${mobileContext.networkQuality}`;
  }

  private estimateDataSize(data: any): number {
    // Rough estimate of JSON data size
    const jsonString = JSON.stringify(data);
    return new Blob([jsonString]).size;
  }

  private generateCursor(data: any[]): string | undefined {
    if (!data.length) return undefined;
    const lastItem = data[data.length - 1];
    return lastItem.createdAt?.toISOString() || lastItem.id;
  }

  private applyCompressionStrategy(data: any, strategy: any): any {
    if (Array.isArray(data)) {
      let result = data.map((item) =>
        this.applyCompressionStrategy(item, strategy),
      );

      if (strategy.truncateArrays && result.length > 50) {
        result = result.slice(0, 50);
      }

      return result;
    }

    if (data && typeof data === "object") {
      const compressed: any = {};

      for (const [key, value] of Object.entries(data)) {
        // Remove null/undefined fields
        if (
          strategy.removeNullFields &&
          (value === null || value === undefined)
        ) {
          continue;
        }

        // Remove metadata fields
        if (strategy.removeMetadata && this.isMetadataField(key)) {
          continue;
        }

        // Abbreviate field names for high compression
        const finalKey = strategy.abbreviateFieldNames
          ? this.abbreviateFieldName(key)
          : key;
        compressed[finalKey] = this.applyCompressionStrategy(value, strategy);
      }

      return compressed;
    }

    return data;
  }

  private isMetadataField(fieldName: string): boolean {
    const metadataFields = ["updatedAt", "__typename", "version", "metadata"];
    return metadataFields.includes(fieldName);
  }

  private abbreviateFieldName(fieldName: string): string {
    const abbreviations: Record<string, string> = {
      createdAt: "cAt",
      updatedAt: "uAt",
      profileImageUrl: "pImg",
      thumbnailUrl: "tImg",
      verificationStatus: "vStat",
      allowComments: "aC",
      allowSharing: "aS",
    };

    return abbreviations[fieldName] || fieldName;
  }
}
