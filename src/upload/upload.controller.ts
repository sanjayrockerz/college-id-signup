import {
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
  BadRequestException,
  UseGuards,
  Logger,
  Req,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';
import { AuthGuard } from '@nestjs/passport';
import * as clamav from 'clamav.js'; // Install clamav.js for malware scanning
import { Express } from 'express';
import { RateLimiterService } from '../common/services/rate-limiter.service';

export function validateFile(file: Express.Multer.File): boolean {
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'application/pdf'];
  const maxFileSize = 5 * 1024 * 1024; 
  // Check file type
  if (!allowedMimeTypes.includes(file.mimetype)) {
    return false;
  }

  // Check file size
  if (file.size > maxFileSize) {
    return false;
  }

  // Magic number detection (basic example for JPEG/PNG/PDF)
  const magicNumbers = {
    'image/jpeg': [0xff, 0xd8, 0xff],
    'image/png': [0x89, 0x50, 0x4e, 0x47],
    'application/pdf': [0x25, 0x50, 0x44, 0x46],
  };
  const fileHeader = file.buffer.slice(0, 4);
  const expectedHeader = magicNumbers[file.mimetype];
  if (
    expectedHeader &&
    !expectedHeader.every((byte, index) => byte === fileHeader[index])
  ) {
    return false;
  }

  return true;
}

async function scanForMalware(file: Express.Multer.File): Promise<boolean> {
  return new Promise((resolve, reject) => {
    clamav.ping(null, 3310, 'localhost', (err) => {
      if (err) {
        reject('ClamAV is not running');
      } else {
        const scanner = clamav.createScanner(3310, 'localhost');
        scanner.scan(file.buffer, (err: Error, _object: any, result: string) => {
          if (err) {
            reject(err);
          } else if (result !== 'OK') {
            reject('Malware detected');
          } else {
            resolve(true);
          }
        });
      }
    });
  });
}

@Controller('upload')
export class UploadController {
  private readonly logger = new Logger(UploadController.name);

  constructor(
    private readonly uploadService: UploadService,
    private readonly rateLimiterService: RateLimiterService,
  ) {}

  @Post()
  @UseGuards(AuthGuard('jwt')) // Ensure authenticated users only
  @UseInterceptors(FilesInterceptor('files', 2)) // Accept up to 2 files
  async uploadFiles(
    @UploadedFiles() files: Array<Express.Multer.File>,
    @Req() req
  ): Promise<{ message: string; files: any[] }> {
    const userId = req.user.id;

    if (await this.rateLimiterService.isRateLimited(userId)) {
      throw new BadRequestException('Rate limit exceeded. Please try again later.');
    }

    this.logger.log(`Upload attempt: ${files.map((file) => file.originalname)}`);

    // Validate each file
    for (const file of files) {
      const isValid = validateFile(file);
      if (!isValid) {
        throw new BadRequestException(
          `Invalid file: ${file.originalname}. Ensure it is a JPG/PNG/PDF and ≤5MB.`,
        );
      }
    }

    // Process the files
    const processedFiles = await Promise.all(
      files.map((file) => this.uploadService.processFile(file)),
    );

    this.logger.log(`Upload success: ${processedFiles}`);
    return { message: 'Files uploaded successfully', files: processedFiles };
  }
}