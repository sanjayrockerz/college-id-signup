export interface CreateConnectionDto {
  receiverId: string;
}

export interface UpdateConnectionDto {
  status: 'ACCEPTED' | 'REJECTED' | 'BLOCKED';
  isCloseFriend?: boolean;
}

export interface ConnectionResponseDto {
  id: string;
  status: string;
  isCloseFriend: boolean;
  createdAt: Date;
  requester: {
    id: string;
    username: string;
    firstName?: string;
    lastName?: string;
    profileImageUrl?: string;
  };
  receiver: {
    id: string;
    username: string;
    firstName?: string;
    lastName?: string;
    profileImageUrl?: string;
  };
}
