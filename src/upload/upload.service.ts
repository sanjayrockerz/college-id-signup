import { Injectable } from '@nestjs/common';
import * as sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument } from 'pdf-lib';

@Injectable()
export class UploadService {
  async processFile(file: Express.Multer.File): Promise<string> {
    const uploadsDir = path.join(__dirname, '../../temp-uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { mode: 0o700 }); // Strict access controls
    }

    let processedBuffer: Buffer;

    if (file.mimetype === 'application/pdf') {
      // Sanitize PDF
      const pdfDoc = await PDFDocument.load(file.buffer);
      pdfDoc.removeJavaScript(); // Remove embedded scripts
      pdfDoc.removeAnnotations(); // Remove annotations
      processedBuffer = await pdfDoc.save();
    } else {
      // Scrub EXIF metadata for images
      processedBuffer = await sharp(file.buffer)
        .withMetadata({ exif: false }) // Remove EXIF metadata
        .toBuffer();
    }

    const filePath = path.join(uploadsDir, `${Date.now()}-${file.originalname}`);
    fs.writeFileSync(filePath, processedBuffer);

    // Automatically delete files after 5 minutes
    setTimeout(() => {
      fs.rmSync(uploadsDir, { recursive: true, force: true });
    }, 300000); // 5 minutes

    return filePath;
  }
}