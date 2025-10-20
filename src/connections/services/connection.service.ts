import {
  Injectable,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import {
  CreateConnectionDto,
  UpdateConnectionDto,
  ConnectionResponseDto,
} from "../dtos/connection.dto";
import { ConnectionRepository } from "../repositories/connection.repository";

@Injectable()
export class ConnectionService {
  constructor(private readonly connectionRepository: ConnectionRepository) {}

  async sendConnectionRequest(
    requesterId: string,
    createConnectionDto: CreateConnectionDto,
  ): Promise<ConnectionResponseDto> {
    const { receiverId } = createConnectionDto;

    if (requesterId === receiverId) {
      throw new BadRequestException(
        "Cannot send connection request to yourself",
      );
    }

    // Check if connection already exists
    const existingConnection = await this.findConnectionBetweenUsers(
      requesterId,
      receiverId,
    );
    if (existingConnection) {
      throw new BadRequestException("Connection request already exists");
    }

    // TODO: Implement with actual repository
    const mockConnection: ConnectionResponseDto = {
      id: "temp-connection-id",
      status: "PENDING",
      isCloseFriend: false,
      createdAt: new Date(),
      requester: {
        id: requesterId,
        username: "requester",
        firstName: "John",
        lastName: "Doe",
        profileImageUrl: null,
      },
      receiver: {
        id: receiverId,
        username: "receiver",
        firstName: "Jane",
        lastName: "Smith",
        profileImageUrl: null,
      },
    };

    return mockConnection;
  }

  async respondToConnectionRequest(
    connectionId: string,
    userId: string,
    updateConnectionDto: UpdateConnectionDto,
  ): Promise<ConnectionResponseDto> {
    // TODO: Verify user is the receiver
    // TODO: Implement with actual repository
    throw new Error("Not implemented");
  }

  async getUserConnections(
    userId: string,
    status?: string,
  ): Promise<ConnectionResponseDto[]> {
    // TODO: Implement with actual repository
    return [];
  }

  async removeConnection(connectionId: string, userId: string): Promise<void> {
    // TODO: Verify user is part of the connection
    // TODO: Implement with actual repository
  }

  async toggleCloseFriend(
    connectionId: string,
    userId: string,
  ): Promise<ConnectionResponseDto> {
    // TODO: Verify user is part of the connection
    // TODO: Implement with actual repository
    throw new Error("Not implemented");
  }

  private async findConnectionBetweenUsers(
    userId1: string,
    userId2: string,
  ): Promise<any> {
    // TODO: Implement with actual repository
    return null;
  }

  async getConnectionStats(userId: string): Promise<{
    totalConnections: number;
    pendingRequests: number;
    closeFriends: number;
  }> {
    // TODO: Implement with actual repository
    return {
      totalConnections: 0,
      pendingRequests: 0,
      closeFriends: 0,
    };
  }
}
