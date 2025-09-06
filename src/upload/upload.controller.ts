import {
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
  BadRequestException,
  Logger,
  Req,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { UploadService, ProcessedFile } from './upload.service';

export function validateFile(file: any): boolean {
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
  const maxFileSize = 10 * 1024 * 1024; // 10MB limit for images
  
  // Check file type - only images allowed
  if (!allowedMimeTypes.includes(file.mimetype)) {
    return false;
  }

  // Check file size
  if (file.size > maxFileSize) {
    return false;
  }

  // Magic number detection for images only
  const magicNumbers = {
    'image/jpeg': [0xff, 0xd8, 0xff],
    'image/jpg': [0xff, 0xd8, 0xff],
    'image/png': [0x89, 0x50, 0x4e, 0x47],
  };
  const fileHeader = file.buffer.slice(0, 4);
  const expectedHeader = magicNumbers[file.mimetype as keyof typeof magicNumbers];
  if (
    expectedHeader &&
    !expectedHeader.every((byte, index) => byte === fileHeader[index])
  ) {
    return false;
  }

  return true;
}

@Controller('upload')
export class UploadController {
  private readonly logger = new Logger(UploadController.name);

  constructor(private readonly uploadService: UploadService) {}

  @Post('image')
  @UseInterceptors(AnyFilesInterceptor())
  async uploadFiles(
    @UploadedFiles() files: any[],
    @Req() req: any
  ): Promise<{ message: string; files: ProcessedFile[] }> {
    this.logger.log(`Upload attempt: ${files?.map((file) => file.originalname) || 'no files'}`);

    if (!files || files.length === 0) {
      throw new BadRequestException('No files provided');
    }

    if (files.length > 2) {
      throw new BadRequestException('Maximum 2 files allowed');
    }

    // Validate each file
    for (const file of files) {
      const isValid = validateFile(file);
      if (!isValid) {
        throw new BadRequestException(
          `Invalid file: ${file.originalname}. Ensure it is a JPG/PNG/WebP image and ≤10MB.`,
        );
      }
    }

    // Process the files
    const processedFiles = await Promise.all(
      files.map((file) => this.uploadService.processFile(file)),
    );

    this.logger.log(`Upload success: ${processedFiles.length} files processed`);
    return { message: 'Files uploaded successfully', files: processedFiles };
  }
}