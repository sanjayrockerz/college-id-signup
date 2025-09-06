import { Module } from '@nestjs/common';
import { IdCardController } from './idcard.controller';
import { IdCardService } from './idcard.service';
import { IdCardRepository } from './idcard.repository';
import { UploadModule } from '../upload/upload.module';
import { PrismaModule } from '../infra/prisma/prisma.module';

@Module({
  imports: [UploadModule, PrismaModule],
  controllers: [IdCardController],
  providers: [IdCardService, IdCardRepository],
  exports: [IdCardService, IdCardRepository],
})
export class IdCardModule {}
