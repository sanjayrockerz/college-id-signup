import { Module } from '@nestjs/common';
import { UploadModule } from './upload/upload.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [UploadModule, AuthModule],
})
export class AppModule {}