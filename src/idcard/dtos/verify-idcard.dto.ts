export interface VerifyIdCardDto {
  studentName: string;
  collegeName: string;
  studentIdNumber?: string;
  graduationYear?: number;
}

export interface IdCardVerificationResult {
  isValid: boolean;
  confidence: number;
  extractedData: {
    studentName: string;
    collegeName: string;
    studentIdNumber?: string;
    graduationYear?: number;
  };
  verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  message: string;
}

export interface IdCardUploadResponse {
  uploadId: string;
  extractedData: {
    studentName: string;
    collegeName: string;
    confidence: number;
  };
  nextStep: string;
  message: string;
}
