export interface PushTask {
  taskId: string;
  userId: string;
  messageId: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  contentPreview: string;
  createdAt: string;
  retryCount: number;
  backoffUntil?: string;
}
