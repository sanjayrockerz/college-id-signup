import { Module } from '@nestjs/common';
import { FeedController } from './controllers/feed.controller';
import { FeedService } from './services/feed.service';
import { FeedRepository } from './repositories/feed.repository';
import { PostModule } from '../posts/post.module';
import { PrismaModule } from '../infra/prisma/prisma.module';

@Module({
  imports: [PostModule, PrismaModule],
  controllers: [FeedController],
  providers: [FeedService, FeedRepository],
  exports: [FeedService, FeedRepository],
})
export class FeedModule {}
