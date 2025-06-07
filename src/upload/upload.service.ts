import { Injectable } from '@nestjs/common';
import * as sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class UploadService {
  async processFile(file: Express.Multer.File): Promise<string> {
    const uploadsDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir);
    }

    let processedBuffer: Buffer;

    if (file.mimetype === 'application/pdf') {
      // For PDFs, save directly without processing
      processedBuffer = file.buffer;
    } else {
      // Scrub EXIF metadata for images
      processedBuffer = await sharp(file.buffer)
        .withMetadata({ exif: false })
        .toBuffer();
    }

    const filePath = path.join(uploadsDir, `${Date.now()}-${file.originalname}`);
    fs.writeFileSync(filePath, processedBuffer);

    // Delete the file after processing (optional)
    setTimeout(() => {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }, 5000);

    return filePath;
  }
}