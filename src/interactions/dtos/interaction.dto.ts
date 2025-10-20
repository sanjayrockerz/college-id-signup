export interface CreateInteractionDto {
  type: "LIKE" | "COMMENT" | "SHARE" | "VIEW";
  postId: string;
}

export interface InteractionResponseDto {
  id: string;
  type: string;
  createdAt: Date;
  user: {
    id: string;
    username: string;
    firstName?: string;
    lastName?: string;
    profileImageUrl?: string;
  };
}
