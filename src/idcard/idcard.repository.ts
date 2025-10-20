import { Injectable } from "@nestjs/common";
import { PrismaService } from "../infra/prisma/prisma.service";

export interface IdCardVerificationData {
  extractedData: {
    studentName: string;
    collegeName: string;
    confidence: number;
  };
  manualData?: {
    studentName: string;
    collegeName: string;
    studentIdNumber?: string;
    graduationYear?: number;
  };
  confidence: number;
  status: "PENDING" | "VERIFIED" | "REJECTED";
  filePath: string;
}

@Injectable()
export class IdCardRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createVerification(
    userId: string,
    data: IdCardVerificationData,
  ): Promise<string> {
    // TODO: Implement with actual database
    const verificationId = `verification-${Date.now()}`;
    return verificationId;
  }

  async getVerificationHistory(userId: string) {
    // TODO: Implement with actual database
    return [];
  }

  async getVerificationById(verificationId: string) {
    // TODO: Implement with actual database
    return null;
  }

  async updateVerificationStatus(
    verificationId: string,
    status: "PENDING" | "VERIFIED" | "REJECTED",
  ) {
    // TODO: Implement with actual database
    return {
      id: verificationId,
      status,
      updatedAt: new Date(),
    };
  }
}
