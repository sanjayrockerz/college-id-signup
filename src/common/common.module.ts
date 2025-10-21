import { Module } from "@nestjs/common";
import { PrismaModule } from "../infra/prisma/prisma.module";
import { DatabaseHealthService } from "./services/database-health.service";
import { MobileOptimizationService } from "./services/mobile-optimization.service";
import { HealthController } from "./controllers/health.controller";

@Module({
  imports: [PrismaModule],
  providers: [DatabaseHealthService, MobileOptimizationService],
  controllers: [HealthController],
  exports: [DatabaseHealthService, MobileOptimizationService],
})
export class CommonModule {}
