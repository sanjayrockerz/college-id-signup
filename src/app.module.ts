
import { Module } from '@nestjs/common';
import { UploadModule } from './upload/upload.module';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { PostModule } from './posts/post.module';
import { FeedModule } from './feed/feed.module';
import { ConnectionModule } from './connections/connection.module';
import { InteractionModule } from './interactions/interaction.module';
import { IdCardModule } from './idcard/idcard.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { CommonModule } from './common/common.module';

@Module({
  imports: [
    PrismaModule,
    CommonModule,
    UploadModule,
    AuthModule,
    UserModule,
    PostModule,
    FeedModule,
    ConnectionModule,
    InteractionModule,
    IdCardModule,
  ],
})
export class AppModule {}