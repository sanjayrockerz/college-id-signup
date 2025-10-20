import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";
import * as tesseract from "node-tesseract-ocr";
import type { Express } from "express";

export interface ExtractedData {
  studentName: string;
  collegeName: string;
  confidence: number;
}

export interface ProcessedFile {
  filePath: string;
  extractedData: ExtractedData;
}

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private readonly uploadsDir = path.join(__dirname, "../../temp-uploads");

  constructor() {
    // Ensure uploads directory exists
    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true, mode: 0o700 });
    }
  }

  async processFile(file: Express.Multer.File): Promise<ProcessedFile> {
    try {
      // Validate that file is an image (no PDFs allowed)
      if (!file.mimetype.startsWith("image/")) {
        throw new BadRequestException("Only image files are allowed");
      }

      // Scrub EXIF metadata for images using sharp
      const processedBuffer = await sharp(file.buffer)
        .withMetadata({}) // Remove all metadata including EXIF
        .jpeg({ quality: 90 }) // Optimize and standardize format
        .toBuffer();

      const fileName = `${Date.now()}-${this.sanitizeFileName(file.originalname)}`;
      const filePath = path.join(this.uploadsDir, fileName);

      // Write processed file
      fs.writeFileSync(filePath, processedBuffer);

      // Extract text using OCR
      const extractedData = await this.extractTextFromImage(filePath);

      // Schedule file deletion after 5 minutes
      this.scheduleFileDeletion(filePath);

      this.logger.log(`File processed successfully: ${fileName}`);

      return { filePath, extractedData };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Error processing file: ${errorMessage}`, errorStack);
      throw error;
    }
  }

  async processFiles(
    files: Express.Multer.File[],
  ): Promise<{ validFiles: Express.Multer.File[]; errors: string[] }> {
    const validFiles: Express.Multer.File[] = [];
    const validationErrors: string[] = [];

    for (const file of files) {
      const validationResult = this.validateFile(file);
      if (validationResult.isValid) {
        validFiles.push(file);
      } else {
        validationErrors.push(...validationResult.errors);
      }
    }

    return { validFiles, errors: validationErrors };
  }

  validateFile(file: Express.Multer.File): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];
    const allowedMimeTypes = [
      "image/jpeg",
      "image/png",
      "image/jpg",
      "image/webp",
    ];
    const maxFileSize = 10 * 1024 * 1024; // 10MB limit for images

    // Check file type - only images allowed
    if (!allowedMimeTypes.includes(file.mimetype)) {
      errors.push(
        `Invalid file type: ${file.mimetype}. Only images (JPEG, PNG, WebP) are allowed.`,
      );
    }

    // Check file size
    if (file.size > maxFileSize) {
      errors.push(
        `File too large: ${file.size} bytes. Maximum allowed: ${maxFileSize} bytes.`,
      );
    }

    // Magic number detection for images
    const magicNumbers = {
      "image/jpeg": [0xff, 0xd8, 0xff],
      "image/jpg": [0xff, 0xd8, 0xff],
      "image/png": [0x89, 0x50, 0x4e, 0x47],
    };

    const fileHeader = file.buffer.slice(0, 4);
    const expectedHeader =
      magicNumbers[file.mimetype as keyof typeof magicNumbers];

    if (
      expectedHeader &&
      !expectedHeader.every((byte, index) => byte === fileHeader[index])
    ) {
      errors.push(`File header does not match MIME type: ${file.mimetype}`);
    }

    return { isValid: errors.length === 0, errors };
  }

  async extractTextFromImage(imagePath: string): Promise<ExtractedData> {
    try {
      const config = {
        lang: "eng",
        oem: 1,
        psm: 3,
      };

      const text = await tesseract.recognize(imagePath, config);
      const lines = text.split("\n").filter((line) => line.trim().length > 0);

      // Enhanced heuristic to extract student and college names
      let studentName = "";
      let collegeName = "";

      for (const line of lines) {
        const cleanLine = line.trim();

        // Look for patterns that might indicate student name
        if (
          cleanLine.toLowerCase().includes("student") ||
          cleanLine.toLowerCase().includes("name:") ||
          (cleanLine.length > 5 &&
            cleanLine.length < 50 &&
            /^[A-Za-z\s.]+$/.test(cleanLine))
        ) {
          if (
            !studentName &&
            !cleanLine.toLowerCase().includes("college") &&
            !cleanLine.toLowerCase().includes("university") &&
            !cleanLine.toLowerCase().includes("institute")
          ) {
            studentName = cleanLine.replace(/student|name:/gi, "").trim();
          }
        }

        // Look for patterns that might indicate college name
        if (
          cleanLine.toLowerCase().includes("college") ||
          cleanLine.toLowerCase().includes("university") ||
          cleanLine.toLowerCase().includes("institute") ||
          cleanLine.toLowerCase().includes("school")
        ) {
          if (!collegeName) {
            collegeName = cleanLine.trim();
          }
        }
      }

      return {
        studentName: studentName || "Not found",
        collegeName: collegeName || "Not found",
        confidence: this.calculateConfidence(studentName, collegeName),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`OCR processing failed: ${errorMessage}`);
      return {
        studentName: "OCR failed",
        collegeName: "OCR failed",
        confidence: 0,
      };
    }
  }

  private sanitizeFileName(fileName: string): string {
    return fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
  }

  private calculateConfidence(
    studentName: string,
    collegeName: string,
  ): number {
    let confidence = 0;

    if (
      studentName &&
      studentName !== "Not found" &&
      studentName !== "OCR failed"
    ) {
      confidence += 50;
    }

    if (
      collegeName &&
      collegeName !== "Not found" &&
      collegeName !== "OCR failed"
    ) {
      confidence += 50;
    }

    return confidence;
  }

  private scheduleFileDeletion(filePath: string): void {
    setTimeout(() => {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          this.logger.log(`Temporary file deleted: ${path.basename(filePath)}`);
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        this.logger.error(`Failed to delete temporary file: ${errorMessage}`);
      }
    }, 300000); // 5 minutes
  }
}
