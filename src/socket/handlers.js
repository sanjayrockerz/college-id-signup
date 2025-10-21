const { getPrismaClient } = require('../config/database');

const isMockPrismaMode = process.env.PRISMA_CLIENT_MODE === 'mock';

const mockStore = {
  conversations: new Map(),
};

let mockMessageCounter = 0;

function ensureMockConversation(conversationId) {
  if (!mockStore.conversations.has(conversationId)) {
    mockStore.conversations.set(conversationId, {
      members: new Map(),
      messages: [],
    });
  }

  return mockStore.conversations.get(conversationId);
}

function hasMockParticipant(conversation, userId) {
  for (const participantId of conversation.members.values()) {
    if (participantId === userId) {
      return true;
    }
  }

  return false;
}

function emitError(socket, message, context = {}) {
  socket.emit('error', {
    message,
    ...context,
  });
}

function buildMockMessage({
  conversationId,
  content,
  senderId,
  messageType,
  mediaUrl,
  attachments,
}) {
  const normalizedContent = typeof content === 'string' ? content.trim() : content || '';

  return {
    id: `mock-msg-${++mockMessageCounter}`,
    conversationId,
    content: normalizedContent,
    senderId,
    messageType,
    mediaUrl: mediaUrl || null,
    attachments: Array.isArray(attachments) ? attachments : [],
    createdAt: new Date().toISOString(),
  };
}

function registerMockSocketHandlers(io) {
  io.on('connection', (socket) => {
    const handshakeUserId = socket.handshake?.query?.userId || null;
    const joinedConversations = new Set();

    console.log(
      `🔌 Socket ${socket.id} connected${handshakeUserId ? ` (userId: ${handshakeUserId})` : ''}`,
    );

    socket.on('join_conversation', (payload = {}) => {
      const { conversationId, userId: payloadUserId } = payload;
      const effectiveUserId = payloadUserId || handshakeUserId;

      if (!conversationId) {
        emitError(socket, 'conversationId is required');
        return;
      }

      if (!effectiveUserId) {
        emitError(socket, 'userId is required');
        return;
      }

      const conversation = ensureMockConversation(conversationId);
      conversation.members.set(socket.id, effectiveUserId);
      joinedConversations.add(conversationId);

      socket.join(`conversation_${conversationId}`);

      socket.emit('conversation_joined', {
        conversationId,
        userId: effectiveUserId,
        joinedAt: new Date().toISOString(),
      });

      socket.to(`conversation_${conversationId}`).emit('user_joined', {
        conversationId,
        userId: effectiveUserId,
        socketId: socket.id,
        timestamp: new Date().toISOString(),
      });
    });

    socket.on('leave_conversation', (payload = {}) => {
      const { conversationId, userId: payloadUserId } = payload;
      const effectiveUserId = payloadUserId || handshakeUserId;

      if (!conversationId) {
        emitError(socket, 'conversationId is required');
        return;
      }

      const conversation = mockStore.conversations.get(conversationId);
      const memberUserId = conversation?.members.get(socket.id) || effectiveUserId || null;

      if (conversation) {
        conversation.members.delete(socket.id);
      }

      joinedConversations.delete(conversationId);

      socket.leave(`conversation_${conversationId}`);

      socket.emit('conversation_left', {
        conversationId,
        userId: memberUserId,
        timestamp: new Date().toISOString(),
      });

      socket.to(`conversation_${conversationId}`).emit('user_left', {
        conversationId,
        userId: memberUserId,
        socketId: socket.id,
        timestamp: new Date().toISOString(),
      });
    });

    socket.on('send_message', (payload = {}) => {
      const {
        conversationId,
        content,
        messageType = 'TEXT',
        attachments,
        mediaUrl,
        userId: payloadUserId,
      } = payload;
      const effectiveUserId = payloadUserId || handshakeUserId;

      if (!conversationId) {
        emitError(socket, 'conversationId is required');
        return;
      }

      if (!effectiveUserId) {
        emitError(socket, 'userId is required');
        return;
      }

      const trimmedContent = typeof content === 'string' ? content.trim() : content || '';

      if (
        !trimmedContent &&
        (!Array.isArray(attachments) || attachments.length === 0) &&
        !mediaUrl
      ) {
        emitError(socket, 'Message content is required');
        return;
      }

      if (trimmedContent && trimmedContent.length > 10_000) {
        emitError(socket, 'Message content is too long');
        return;
      }

      const conversation = ensureMockConversation(conversationId);

      if (!hasMockParticipant(conversation, effectiveUserId)) {
        emitError(socket, 'You are not a participant in this conversation');
        return;
      }

      const message = buildMockMessage({
        conversationId,
        content: trimmedContent,
        senderId: effectiveUserId,
        messageType,
        mediaUrl,
        attachments,
      });

      conversation.messages.push(message);

      socket.emit('message_sent', message);
      socket.to(`conversation_${conversationId}`).emit('new_message', message);
    });

    const typingHandler = (payload = {}) => {
      const { conversationId, isTyping, userId: payloadUserId } = payload;
      const effectiveUserId = payloadUserId || handshakeUserId;

      if (!conversationId) {
        emitError(socket, 'conversationId is required');
        return;
      }

      if (!effectiveUserId) {
        emitError(socket, 'userId is required');
        return;
      }

      socket.to(`conversation_${conversationId}`).emit('user_typing', {
        conversationId,
        userId: effectiveUserId,
        socketId: socket.id,
        isTyping: Boolean(isTyping),
        timestamp: new Date().toISOString(),
      });
    };

    socket.on('typing_indicator', typingHandler);
    socket.on('typing_start', (payload = {}) => typingHandler({ ...payload, isTyping: true }));
    socket.on('typing_stop', (payload = {}) => typingHandler({ ...payload, isTyping: false }));

    const markReadHandler = (payload = {}) => {
      const { conversationId, messageIds, userId: payloadUserId } = payload;
      const effectiveUserId = payloadUserId || handshakeUserId;

      if (!conversationId) {
        emitError(socket, 'conversationId is required');
        return;
      }

      if (!effectiveUserId) {
        emitError(socket, 'userId is required');
        return;
      }

      if (!Array.isArray(messageIds) || messageIds.length === 0) {
        emitError(socket, 'messageIds must be a non-empty array');
        return;
      }

      socket.to(`conversation_${conversationId}`).emit('messages_read', {
        conversationId,
        userId: effectiveUserId,
        messageIds,
        timestamp: new Date().toISOString(),
      });
    };

    socket.on('mark_as_read', markReadHandler);
    socket.on('mark_message_read', markReadHandler);

    socket.on('disconnect', () => {
      console.log(
        `🔌 Socket ${socket.id} disconnected${handshakeUserId ? ` (userId: ${handshakeUserId})` : ''}`,
      );

      for (const conversationId of joinedConversations) {
        const conversation = mockStore.conversations.get(conversationId);

        if (!conversation) {
          continue;
        }

        const memberUserId = conversation.members.get(socket.id) || handshakeUserId || null;
        conversation.members.delete(socket.id);

        socket.to(`conversation_${conversationId}`).emit('user_left', {
          conversationId,
          userId: memberUserId,
          socketId: socket.id,
          timestamp: new Date().toISOString(),
        });
      }

      joinedConversations.clear();
    });
  });
}

function registerDatabaseSocketHandlers(io) {
  const prisma = getPrismaClient();

  io.on('connection', (socket) => {
    const handshakeUserId = socket.handshake?.query?.userId || socket.userId;

    console.log(
      `🔌 Socket ${socket.id} connected${handshakeUserId ? ` (userId: ${handshakeUserId})` : ''}`,
    );

    if (handshakeUserId) {
      socket.join(`user_${handshakeUserId}`);

      (async () => {
        try {
          const conversations = await prisma.conversation.findMany({
            where: { conversationUsers: { some: { userId: handshakeUserId } } },
            select: { id: true },
          });

          conversations.forEach((conv) => socket.join(`conversation_${conv.id}`));
          console.log(
            `✅ User ${handshakeUserId} joined ${conversations.length} conversation rooms.`,
          );
        } catch (err) {
          console.error('Error joining conversation rooms:', err);
        }
      })();
    }

    socket.on('join_conversation', (payload = {}) => {
      const { conversationId, userId: payloadUserId } = payload;
      const effectiveUserId = payloadUserId || handshakeUserId;

      if (!conversationId) {
        emitError(socket, 'conversationId is required');
        return;
      }

      if (!effectiveUserId) {
        emitError(socket, 'userId is required');
        return;
      }

      socket.join(`conversation_${conversationId}`);

      socket.emit('conversation_joined', {
        conversationId,
        userId: effectiveUserId,
        joinedAt: new Date().toISOString(),
      });

      socket.to(`conversation_${conversationId}`).emit('user_joined', {
        conversationId,
        userId: effectiveUserId,
        socketId: socket.id,
        timestamp: new Date().toISOString(),
      });
    });

    socket.on('leave_conversation', (payload = {}) => {
      const { conversationId, userId: payloadUserId } = payload;
      const effectiveUserId = payloadUserId || handshakeUserId;

      if (!conversationId) {
        emitError(socket, 'conversationId is required');
        return;
      }

      socket.leave(`conversation_${conversationId}`);

      socket.emit('conversation_left', {
        conversationId,
        userId: effectiveUserId || null,
        timestamp: new Date().toISOString(),
      });

      socket.to(`conversation_${conversationId}`).emit('user_left', {
        conversationId,
        userId: effectiveUserId || null,
        socketId: socket.id,
        timestamp: new Date().toISOString(),
      });
    });

    socket.on('send_message', async (payload = {}) => {
      try {
        const {
          conversationId,
          content,
          messageType = 'TEXT',
          attachments = [],
          userId: payloadUserId,
        } = payload;

        const effectiveUserId = payloadUserId || handshakeUserId;

        if (!conversationId) {
          emitError(socket, 'conversationId is required');
          return;
        }

        if (!effectiveUserId) {
          emitError(socket, 'userId is required');
          return;
        }

        if (!content?.trim() && attachments.length === 0) {
          emitError(socket, 'Message content is required');
          return;
        }

        if (content?.length > 10_000) {
          emitError(socket, 'Message content is too long');
          return;
        }

        const membership = await prisma.conversationUser.findFirst({
          where: {
            conversationId,
            userId: effectiveUserId,
            isActive: true,
          },
        });

        if (!membership) {
          emitError(socket, 'You are not a participant in this conversation');
          return;
        }

        const result = await prisma.$transaction(async (tx) => {
          const createdMessage = await tx.message.create({
            data: {
              content,
              type: messageType,
              senderId: effectiveUserId,
              conversationId,
            },
          });

          if (Array.isArray(attachments) && attachments.length) {
            await Promise.all(
              attachments.map((att) =>
                tx.attachment.create({
                  data: {
                    filename: att.filename || att.fileName || 'file',
                    originalName: att.originalName || att.originalFileName || att.filename,
                    mimeType: att.mimeType || att.fileType,
                    size: att.size || att.fileSize || 0,
                    url: att.url || att.fileUrl,
                    uploaderId: effectiveUserId,
                    messageId: createdMessage.id,
                  },
                }),
              ),
            );
          }

          await tx.conversation.update({
            where: { id: conversationId },
            data: {
              updatedAt: new Date(),
              lastMessageAt: new Date(),
              lastMessageId: createdMessage.id,
            },
          });

          return tx.message.findUnique({
            where: { id: createdMessage.id },
            include: {
              sender: {
                select: {
                  id: true,
                  username: true,
                  firstName: true,
                  lastName: true,
                  profileImageUrl: true,
                  isVerified: true,
                },
              },
              attachments: true,
            },
          });
        });

        const messagePayload = {
          ...result,
          author: result.sender,
          conversationId,
        };

        socket.to(`conversation_${conversationId}`).emit('new_message', messagePayload);
        socket.emit('message_sent', messagePayload);
      } catch (err) {
        console.error('send_message handler error:', err);
        emitError(socket, 'Failed to send message');
      }
    });

    const databaseTypingHandler = (payload = {}) => {
      const { conversationId, isTyping, userId: payloadUserId } = payload;
      const effectiveUserId = payloadUserId || handshakeUserId;

      if (!conversationId) {
        emitError(socket, 'conversationId is required');
        return;
      }

      if (!effectiveUserId) {
        emitError(socket, 'userId is required');
        return;
      }

      socket.to(`conversation_${conversationId}`).emit('user_typing', {
        conversationId,
        userId: effectiveUserId,
        socketId: socket.id,
        isTyping: Boolean(isTyping),
        timestamp: new Date().toISOString(),
      });
    };

    socket.on('typing_indicator', databaseTypingHandler);
    socket.on('typing_start', (payload = {}) => databaseTypingHandler({ ...payload, isTyping: true }));
    socket.on('typing_stop', (payload = {}) => databaseTypingHandler({ ...payload, isTyping: false }));

    const databaseMarkReadHandler = async (payload = {}) => {
      try {
        const { messageIds, conversationId, userId: payloadUserId } = payload;
        const effectiveUserId = payloadUserId || handshakeUserId;

        if (!conversationId) {
          emitError(socket, 'conversationId is required');
          return;
        }

        if (!effectiveUserId) {
          emitError(socket, 'userId is required');
          return;
        }

        if (!Array.isArray(messageIds) || messageIds.length === 0) {
          emitError(socket, 'messageIds must be a non-empty array');
          return;
        }

        await prisma.$transaction(async (tx) => {
          await Promise.all(
            messageIds.map((messageId) =>
              tx.messageRead.upsert({
                where: {
                  messageId_userId: {
                    messageId,
                    userId: effectiveUserId,
                  },
                },
                update: { readAt: new Date() },
                create: {
                  messageId,
                  userId: effectiveUserId,
                  readAt: new Date(),
                },
              }),
            ),
          );
        });

        socket.to(`conversation_${conversationId}`).emit('messages_read', {
          conversationId,
          userId: effectiveUserId,
          messageIds,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        console.error('mark_message_read error:', err);
        emitError(socket, 'Failed to mark messages as read');
      }
    };

    socket.on('mark_as_read', databaseMarkReadHandler);
    socket.on('mark_message_read', databaseMarkReadHandler);

    socket.on('disconnect', () => {
      console.log(
        `🔌 Socket ${socket.id} disconnected${handshakeUserId ? ` (userId: ${handshakeUserId})` : ''}`,
      );
    });
  });
}

function registerSocketHandlers(io) {
  if (isMockPrismaMode) {
    registerMockSocketHandlers(io);
  } else {
    registerDatabaseSocketHandlers(io);
  }
}

module.exports = { registerSocketHandlers };
