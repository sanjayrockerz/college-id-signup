import { Module } from "@nestjs/common";
import { InteractionController } from "./controllers/interaction.controller";
import { InteractionService } from "./services/interaction.service";
import { InteractionRepository } from "./repositories/interaction.repository";
import { PrismaModule } from "../infra/prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [InteractionController],
  providers: [InteractionService, InteractionRepository],
  exports: [InteractionService, InteractionRepository],
})
export class InteractionModule {}
