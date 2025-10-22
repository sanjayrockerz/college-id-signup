import { Module } from '@nestjs/common';
import { PostController } from './controllers/post.controller';
import { PostService } from './services/post.service';
import { PostRepository } from './repositories/post.repository';
import { PrismaModule } from '../infra/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PostController],
  providers: [PostService, PostRepository],
  exports: [PostService, PostRepository],
})
export class PostModule {}
