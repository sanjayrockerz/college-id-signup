import { Module } from "@nestjs/common";
import { ConnectionController } from "./controllers/connection.controller";
import { ConnectionService } from "./services/connection.service";
import { ConnectionRepository } from "./repositories/connection.repository";
import { PrismaModule } from "../infra/prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [ConnectionController],
  providers: [ConnectionService, ConnectionRepository],
  exports: [ConnectionService, ConnectionRepository],
})
export class ConnectionModule {}
