import { Module } from '@nestjs/common';
import { UserController } from './application/user.controller';
import { UserService } from './application/user.service';
import { UserRepository } from './data/user.repository';
import { PrismaModule } from '../infra/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [UserController],
  providers: [UserService, UserRepository],
  exports: [UserService, UserRepository],
})
export class UserModule {}