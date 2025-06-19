import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class DeleteService {
  async deleteFile(fileName: string): Promise<void> {
    const uploadsDir = path.join(__dirname, '../../temp-uploads');
    const filePath = path.join(uploadsDir, fileName);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    } else {
      throw new Error('File not found');
    }
  }
}

