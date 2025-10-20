import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Request,
} from "@nestjs/common";
import { ConnectionService } from "../services/connection.service";
import {
  CreateConnectionDto,
  UpdateConnectionDto,
} from "../dtos/connection.dto";

@Controller("connections")
export class ConnectionController {
  constructor(private readonly connectionService: ConnectionService) {}

  @Post()
  async sendConnectionRequest(
    @Body() createConnectionDto: CreateConnectionDto,
    @Request() req: any,
  ) {
    const userId = req.user?.id || "temp-user-id";
    return this.connectionService.sendConnectionRequest(
      userId,
      createConnectionDto,
    );
  }

  @Get()
  async getConnections(@Request() req: any) {
    const userId = req.user?.id || "temp-user-id";
    return this.connectionService.getUserConnections(userId);
  }

  @Put(":id")
  async respondToRequest(
    @Param("id") connectionId: string,
    @Body() updateConnectionDto: UpdateConnectionDto,
    @Request() req: any,
  ) {
    const userId = req.user?.id || "temp-user-id";
    return this.connectionService.respondToConnectionRequest(
      connectionId,
      userId,
      updateConnectionDto,
    );
  }

  @Delete(":id")
  async removeConnection(
    @Param("id") connectionId: string,
    @Request() req: any,
  ) {
    const userId = req.user?.id || "temp-user-id";
    await this.connectionService.removeConnection(connectionId, userId);
    return { message: "Connection removed successfully" };
  }

  @Post(":id/close-friend")
  async toggleCloseFriend(
    @Param("id") connectionId: string,
    @Request() req: any,
  ) {
    const userId = req.user?.id || "temp-user-id";
    return this.connectionService.toggleCloseFriend(connectionId, userId);
  }

  @Get("stats")
  async getConnectionStats(@Request() req: any) {
    const userId = req.user?.id || "temp-user-id";
    return this.connectionService.getConnectionStats(userId);
  }
}
