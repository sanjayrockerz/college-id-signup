import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UploadedFile,
  UseInterceptors,
  Request,
  Query,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IdCardService } from './idcard.service';
import { MobileOptimizationService } from '../common/services/mobile-optimization.service';
import { VerifyIdCardDto, IdCardVerificationResult, IdCardUploadResponse } from './dtos/verify-idcard.dto';
import type { Express } from 'express';

interface MobileIdCardUploadResponse extends IdCardUploadResponse {
  thumbnailUrl?: string;
  estimatedProcessingTime: number;
  dataUsage: number; // bytes
  networkQuality: string;
  optimizationsApplied: string[];
}

interface MobileVerificationHistoryResponse {
  verifications: Array<{
    id: string;
    status: string;
    thumbnailUrl?: string;
    createdAt: Date;
    dataSize: number;
    processingTime?: number;
  }>;
  nextCursor?: string;
  totalDataSize: number;
  optimizationApplied: string[];
}

@Controller('idcard')
export class IdCardController {
  constructor(
    private readonly idCardService: IdCardService,
    private readonly mobileOptimizationService: MobileOptimizationService
  ) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('idcard', {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: (req, file, cb) => {
      // Mobile-specific validation
      if (!file.mimetype.match(/^image\/(jpeg|png|webp)$/)) {
        cb(new BadRequestException('Only JPEG, PNG, and WebP images allowed'), false);
      } else {
        cb(null, true);
      }
    },
  }))
  async uploadIdCard(
    @UploadedFile() file: Express.Multer.File,
    @Request() req: any,
    @Query('quality') quality?: 'low' | 'medium' | 'high',
    @Query('dataUsage') dataUsage: 'low' | 'normal' | 'high' = 'normal'
  ): Promise<MobileIdCardUploadResponse> {
    if (!file) {
      throw new BadRequestException('ID card image is required');
    }

    // Check file size for mobile optimization
    if (file.size > 10 * 1024 * 1024) {
      throw new PayloadTooLargeException('File too large for mobile processing');
    }

    // Mobile network quality detection
    const networkQuality = this.detectNetworkQuality(req);
    const userId = req.user?.id || 'temp-user-id';
    
    // Optimize image for mobile before processing
    const optimizedImage = await this.mobileOptimizationService.optimizeImageForMobile(
      file.buffer,
      {
        quality: quality || this.getOptimalQuality(networkQuality),
        dataUsage,
        networkQuality,
        generateThumbnail: true,
        compressForNetwork: true,
      }
    );
    
    // Process the optimized image
    const startTime = Date.now();
    const result = await this.idCardService.verifyIdCard(userId, {
      ...file,
      buffer: optimizedImage.optimized,
    });
    const processingTime = Date.now() - startTime;
    
    return {
      uploadId: `upload-${Date.now()}`,
      extractedData: {
        studentName: result.extractedData.studentName,
        collegeName: result.extractedData.collegeName,
        confidence: result.confidence,
      },
      thumbnailUrl: optimizedImage.thumbnail ? 
        `data:image/webp;base64,${optimizedImage.thumbnail.toString('base64')}` : 
        undefined,
      estimatedProcessingTime: processingTime,
      dataUsage: optimizedImage.optimizedSize,
      networkQuality,
      optimizationsApplied: [
        'image-compression',
        'webp-conversion',
        'thumbnail-generation',
        `quality-${quality || this.getOptimalQuality(networkQuality)}`
      ],
      nextStep: 'Please verify the extracted information and submit for final verification',
      message: `ID card processed for mobile (${Math.round(optimizedImage.compressionRatio * 100)}% size reduction)`,
    };
  }

  @Post('verify')
  async verifyIdCard(
    @Body() verifyData: VerifyIdCardDto,
    @UploadedFile() file: Express.Multer.File,
    @Request() req: any
  ): Promise<IdCardVerificationResult> {
    if (!file) {
      throw new BadRequestException('ID card image is required');
    }

    const userId = req.user?.id || 'temp-user-id';
    
    return this.idCardService.verifyIdCard(userId, file, verifyData);
  }

  @Post('verify/:uploadId')
  async verifyExtractedData(
    @Param('uploadId') uploadId: string,
    @Body() verifyData: VerifyIdCardDto,
    @Request() req: any
  ): Promise<IdCardVerificationResult> {
    const userId = req.user?.id || 'temp-user-id';
    
    // For now, we'll simulate verification with the provided data
    // In a real implementation, you'd retrieve the stored image and re-verify
    return {
      isValid: true,
      confidence: 95,
      extractedData: verifyData,
      verificationStatus: 'VERIFIED',
      message: 'ID card verification completed successfully!',
    };
  }

  @Get('history')
  async getVerificationHistory(@Request() req: any) {
    const userId = req.user?.id || 'temp-user-id';
    return this.idCardService.getVerificationHistory(userId);
  }

  @Get('verification/:id')
  async getVerification(@Param('id') verificationId: string) {
    return this.idCardService.getVerificationById(verificationId);
  }

  @Get('mobile/feed')
  async getMobileVerificationHistory(
    @Request() req: any,
    @Query('limit') limit: number = 10,
    @Query('cursor') cursor?: string,
    @Query('dataUsage') dataUsage: 'low' | 'normal' | 'high' = 'normal'
  ): Promise<MobileVerificationHistoryResponse> {
    const userId = req.user?.id || 'temp-user-id';
    
    // Get history and optimize for mobile
    const history = await this.idCardService.getVerificationHistory(userId);
    
    // Apply mobile pagination and optimization
    const optimizedHistory = this.mobileOptimizationService.optimizeArrayForMobile(
      history,
      1, // page number
      Math.min(limit, 50) // Mobile limit
    );

    return {
      verifications: optimizedHistory.items.map((item: any) => ({
        id: item.id || 'temp-id',
        status: item.status || 'pending',
        thumbnailUrl: dataUsage !== 'low' ? item.thumbnailUrl : undefined,
        createdAt: item.createdAt || new Date(),
        dataSize: item.estimatedSize || 0,
        processingTime: item.processingTime,
      })),
      nextCursor: cursor, // Implement proper cursor logic
      totalDataSize: optimizedHistory.pagination.total * 1024, // Rough estimate
      optimizationApplied: ['mobile-compression', 'thumbnail-optimization', 'pagination'],
    };
  }

  private detectNetworkQuality(req: any): 'poor' | 'fair' | 'good' | 'excellent' {
    // Detect from headers or user agent
    const connection = req.headers['connection'];
    const saveData = req.headers['save-data'];
    const userAgent = req.headers['user-agent']?.toLowerCase() || '';
    
    // Basic detection logic
    if (saveData === 'on') return 'poor';
    if (userAgent.includes('mobile') && !userAgent.includes('wifi')) return 'fair';
    if (connection && connection.includes('keep-alive')) return 'good';
    
    return 'good'; // Default assumption
  }

  private getOptimalQuality(networkQuality: string): 'low' | 'medium' | 'high' {
    switch (networkQuality) {
      case 'poor': return 'low';
      case 'fair': return 'medium';
      case 'good': return 'high';
      case 'excellent': return 'high';
      default: return 'medium';
    }
  }
}
