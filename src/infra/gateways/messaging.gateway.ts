import { Injectable, Logger } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { PresenceRegistryService } from "../services/presence-registry.service";

interface HeartbeatPayload {
  readonly userId?: string;
}

@WebSocketGateway({
  namespace: "/messages",
  cors: {
    origin: process.env.SOCKET_CORS_ORIGIN?.split(",") ?? [
      "http://localhost:3000",
    ],
    credentials: true,
  },
})
@Injectable()
export class MessagingGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private readonly server!: Server;

  private readonly logger = new Logger(MessagingGateway.name);

  constructor(private readonly presenceRegistry: PresenceRegistryService) {}

  afterInit(): void {
    this.logger.log("Messaging gateway initialized");
  }

  async handleConnection(client: Socket): Promise<void> {
    const userId = this.resolveUserId(client);
    if (!userId) {
      client.emit("error", { message: "Missing userId for socket connection" });
      client.disconnect(true);
      return;
    }

    client.join(this.userRoom(userId));

    try {
      await this.presenceRegistry.registerSocket(userId, client.id, {
        agent: this.resolveUserAgent(client),
        instanceId: process.env.INSTANCE_ID,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to register presence for user ${userId}`,
        error instanceof Error ? error : undefined,
      );
    }

    this.logger.debug(`Socket connected ${client.id} for user ${userId}`);
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const userId = this.resolveUserId(client);
    if (!userId) {
      return;
    }

    try {
      await this.presenceRegistry.unregisterSocket(userId, client.id);
    } catch (error) {
      this.logger.warn(
        `Failed to unregister presence for user ${userId}`,
        error instanceof Error ? error : undefined,
      );
    }

    this.logger.debug(`Socket disconnected ${client.id} for user ${userId}`);
  }

  @SubscribeMessage("heartbeat")
  async handleHeartbeat(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: HeartbeatPayload = {},
  ): Promise<void> {
    const userId = payload.userId || this.resolveUserId(client);
    if (!userId) {
      client.emit("error", { message: "Missing userId for heartbeat" });
      return;
    }

    try {
      await this.presenceRegistry.heartbeat(userId, client.id);
    } catch (error) {
      this.logger.warn(
        `Failed to extend heartbeat for user ${userId}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  private resolveUserId(client: Socket): string | null {
    const userId = (client.handshake.auth?.userId ||
      client.handshake.query?.userId ||
      client.data?.userId) as string | undefined;
    if (typeof userId === "string" && userId.trim().length > 0) {
      client.data.userId = userId;
      return userId;
    }
    return null;
  }

  private resolveUserAgent(client: Socket): string | undefined {
    const ua = client.handshake.headers["user-agent"];
    return typeof ua === "string" ? ua : undefined;
  }

  private userRoom(userId: string): string {
    return `user_${userId}`;
  }
}
