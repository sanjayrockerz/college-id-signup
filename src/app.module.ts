import { Module } from "@nestjs/common";
import { UserModule } from "./user/user.module";
import { ChatModule } from "./chat-backend/chat.module";
import { PrismaModule } from "./infra/prisma/prisma.module";
import { CommonModule } from "./common/common.module";

@Module({
  imports: [PrismaModule, CommonModule, UserModule, ChatModule],
})
export class AppModule {}
