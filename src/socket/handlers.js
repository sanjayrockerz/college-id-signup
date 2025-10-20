const { getPrismaClient } = require('../config/database');

function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    const userId = socket.handshake?.query?.userId || socket.userId;

    console.log(`🔌 Socket ${socket.id} connected${userId ? ` (userId: ${userId})` : ''}`);

    if (userId) {
      socket.join(`user_${userId}`);

      (async () => {
        try {
          const prisma = getPrismaClient();
          const conversations = await prisma.conversation.findMany({
            where: { conversationUsers: { some: { userId } } },
            select: { id: true }
          });
          conversations.forEach((conv) => socket.join(`conversation_${conv.id}`));
          console.log(`✅ User ${userId} joined ${conversations.length} conversation rooms.`);
        } catch (err) {
          console.error('Error joining conversation rooms:', err);
        }
      })();
    }

    socket.on('join_conversation', ({ conversationId, userId: eventUserId } = {}) => {
      if (!conversationId) {
        socket.emit('conversation_error', { error: 'Missing conversationId' });
        return;
      }

      const targetUserId = eventUserId || userId;
      socket.join(`conversation_${conversationId}`);
      socket.to(`conversation_${conversationId}`).emit('user_joined', {
        userId: targetUserId,
        socketId: socket.id,
        timestamp: new Date()
      });
    });

    socket.on('leave_conversation', ({ conversationId, userId: eventUserId } = {}) => {
      if (!conversationId) {
        socket.emit('conversation_error', { error: 'Missing conversationId' });
        return;
      }

      const targetUserId = eventUserId || userId;
      socket.leave(`conversation_${conversationId}`);
      socket.to(`conversation_${conversationId}`).emit('user_left', {
        userId: targetUserId,
        socketId: socket.id,
        timestamp: new Date()
      });
    });

    socket.on('send_message', async (data = {}) => {
      try {
        const {
          conversationId,
          content,
          type = 'TEXT',
          attachments = [],
          userId: senderId
        } = data;

        if (!conversationId) {
          socket.emit('message_error', { error: 'Missing conversationId' });
          return;
        }

        const messageSenderId = senderId || userId;

        if (!messageSenderId) {
          socket.emit('message_error', { error: 'Missing userId', message: 'Must provide userId' });
          return;
        }

        const prisma = getPrismaClient();

        const membership = await prisma.conversationUser.findFirst({
          where: { conversationId, userId: messageSenderId, isActive: true }
        });

        if (!membership) {
          socket.emit('message_error', { error: 'Access denied', message: 'Not a member' });
          return;
        }

        const result = await prisma.$transaction(async (tx) => {
          const createdMessage = await tx.message.create({
            data: { content, type, senderId: messageSenderId, conversationId }
          });

          if (Array.isArray(attachments) && attachments.length) {
            await Promise.all(
              attachments.map((att) => tx.attachment.create({
                data: {
                  filename: att.filename || att.fileName || 'file',
                  originalName: att.originalName || att.originalFileName || att.filename,
                  mimeType: att.mimeType || att.fileType,
                  size: att.size || att.fileSize || 0,
                  url: att.url || att.fileUrl,
                  uploaderId: messageSenderId,
                  messageId: createdMessage.id
                }
              }))
            );
          }

          await tx.conversation.update({
            where: { id: conversationId },
            data: {
              updatedAt: new Date(),
              lastMessageAt: new Date(),
              lastMessageId: createdMessage.id
            }
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
                  isVerified: true
                }
              },
              attachments: true
            }
          });
        });

        socket.to(`conversation_${conversationId}`).emit('new_message', {
          ...result,
          author: result.sender,
          conversationId
        });

        socket.emit('message_sent', {
          ...result,
          author: result.sender,
          conversationId
        });
      } catch (err) {
        console.error('send_message handler error:', err);
        socket.emit('message_error', { error: 'Failed to send message' });
      }
    });

    socket.on('typing_start', ({ conversationId, userId: typingUserId } = {}) => {
      if (!conversationId) {
        return;
      }
      const targetUserId = typingUserId || userId;
      socket.to(`conversation_${conversationId}`).emit('user_typing', {
        userId: targetUserId,
        socketId: socket.id,
        isTyping: true
      });
    });

    socket.on('typing_stop', ({ conversationId, userId: typingUserId } = {}) => {
      if (!conversationId) {
        return;
      }
      const targetUserId = typingUserId || userId;
      socket.to(`conversation_${conversationId}`).emit('user_typing', {
        userId: targetUserId,
        socketId: socket.id,
        isTyping: false
      });
    });

    socket.on('mark_message_read', async (data = {}) => {
      try {
        const { messageId, conversationId, userId: readerId } = data;
        if (!messageId || !conversationId) {
          socket.emit('message_error', { error: 'Missing identifiers' });
          return;
        }

        const targetUserId = readerId || userId;

        if (!targetUserId) {
          socket.emit('message_error', { error: 'Missing userId' });
          return;
        }

        const prisma = getPrismaClient();
        await prisma.messageRead.upsert({
          where: { messageId_userId: { messageId, userId: targetUserId } },
          update: { readAt: new Date() },
          create: { messageId, userId: targetUserId, readAt: new Date() }
        });

        socket.to(`conversation_${conversationId}`).emit('message_read', {
          messageId,
          userId: targetUserId,
          readAt: new Date()
        });
      } catch (err) {
        console.error('mark_message_read error:', err);
      }
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Socket ${socket.id} disconnected${userId ? ` (userId: ${userId})` : ''}`);
    });
  });
}

module.exports = { registerSocketHandlers };
