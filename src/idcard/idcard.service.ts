import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { VerifyIdCardDto, IdCardVerificationResult } from './dtos/verify-idcard.dto';
import { IdCardRepository } from './idcard.repository';
import { UploadService } from '../upload/upload.service';
import type { Express } from 'express';

@Injectable()
export class IdCardService {
  private readonly logger = new Logger(IdCardService.name);

  constructor(
    private readonly idCardRepository: IdCardRepository,
    private readonly uploadService: UploadService
  ) {}

  async verifyIdCard(
    userId: string,
    file: Express.Multer.File,
    verifyData?: VerifyIdCardDto
  ): Promise<IdCardVerificationResult> {
    try {
      // Process the uploaded ID card image
      const processedFile = await this.uploadService.processFile(file);
      const { extractedData } = processedFile;

      // If manual verification data is provided, use it for comparison
      if (verifyData) {
        const verification = this.compareExtractedData(extractedData, verifyData);
        
        // Store verification attempt
        await this.idCardRepository.createVerification(userId, {
          extractedData,
          manualData: verifyData,
          confidence: verification.confidence,
          status: verification.isValid ? 'VERIFIED' : 'REJECTED',
          filePath: processedFile.filePath,
        });

        return verification;
      }

      // If no manual data provided, return extracted data for manual verification
      const verificationId = await this.idCardRepository.createVerification(userId, {
        extractedData,
        confidence: extractedData.confidence,
        status: 'PENDING',
        filePath: processedFile.filePath,
      });

      return {
        isValid: false,
        confidence: extractedData.confidence,
        extractedData: {
          studentName: extractedData.studentName,
          collegeName: extractedData.collegeName,
        },
        verificationStatus: 'PENDING',
        message: 'Please verify the extracted information and submit for final verification.',
      };
    } catch (error) {
      this.logger.error(`ID card verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw new BadRequestException('Failed to process ID card image');
    }
  }

  private compareExtractedData(
    extracted: { studentName: string; collegeName: string; confidence: number },
    manual: VerifyIdCardDto
  ): IdCardVerificationResult {
    let confidence = extracted.confidence;
    let isValid = false;

    // Compare names (fuzzy matching)
    const nameMatch = this.fuzzyMatch(extracted.studentName, manual.studentName);
    const collegeMatch = this.fuzzyMatch(extracted.collegeName, manual.collegeName);

    // Calculate verification confidence
    if (nameMatch > 0.7 && collegeMatch > 0.7) {
      confidence = Math.min(100, confidence + 30);
      isValid = confidence >= 70;
    } else if (nameMatch > 0.5 || collegeMatch > 0.5) {
      confidence = Math.min(100, confidence + 10);
      isValid = confidence >= 80; // Higher threshold for partial matches
    }

    return {
      isValid,
      confidence,
      extractedData: {
        studentName: manual.studentName,
        collegeName: manual.collegeName,
        studentIdNumber: manual.studentIdNumber,
        graduationYear: manual.graduationYear,
      },
      verificationStatus: isValid ? 'VERIFIED' : 'REJECTED',
      message: isValid 
        ? 'ID card verification successful!'
        : 'ID card verification failed. Please ensure the information matches your ID card.',
    };
  }

  private fuzzyMatch(str1: string, str2: string): number {
    if (!str1 || !str2) return 0;
    
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();
    
    if (s1 === s2) return 1;
    
    // Simple similarity calculation
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    
    if (longer.length === 0) return 1;
    
    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  async getVerificationHistory(userId: string) {
    return this.idCardRepository.getVerificationHistory(userId);
  }

  async getVerificationById(verificationId: string) {
    return this.idCardRepository.getVerificationById(verificationId);
  }
}
