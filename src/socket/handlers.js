const { getPrismaClient } = require('../config/database');
const { socketAuthMiddleware } = require('../middleware/socketAuth');

function registerSocketHandlers(io) {
  // Ensure socket auth middleware is applied
  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    console.log(`🔌 User ${socket.userId} connected via Socket.IO`);

    // Join user's personal room
    socket.join(`user_${socket.userId}`);

    // Auto-join conversation rooms
    (async () => {
      try {
        const prisma = getPrismaClient();
        const conversations = await prisma.conversation.findMany({
          where: { participants: { some: { userId: socket.userId } } },
          select: { id: true }
        });
        conversations.forEach(conv => socket.join(`conversation_${conv.id}`));
        console.log(`✅ User ${socket.userId} joined ${conversations.length} conversation rooms.`);
      } catch (err) {
        console.error('Error joining conversation rooms:', err);
      }
    })();

    socket.on('join_conversation', (conversationId) => {
      socket.join(`conversation_${conversationId}`);
      socket.to(`conversation_${conversationId}`).emit('user_joined', {
        userId: socket.userId,
        username: socket.user.username,
        timestamp: new Date()
      });
    });

    socket.on('leave_conversation', (conversationId) => {
      socket.leave(`conversation_${conversationId}`);
      socket.to(`conversation_${conversationId}`).emit('user_left', {
        userId: socket.userId,
        username: socket.user.username,
        timestamp: new Date()
      });
    });

    socket.on('send_message', async (data) => {
      try {
        const { conversationId, content, type = 'TEXT', attachments = [] } = data;
        const prisma = getPrismaClient();

        // Validate membership
        const membership = await prisma.conversationUser.findFirst({
          where: { conversationId, userId: socket.userId, isActive: true }
        });
        if (!membership) {
          socket.emit('message_error', { error: 'Access denied', message: 'Not a member' });
          return;
        }

        const result = await prisma.$transaction(async (tx) => {
          const createdMessage = await tx.message.create({ data: { content, type, senderId: socket.userId, conversationId } });
          if (Array.isArray(attachments) && attachments.length) {
            await Promise.all(attachments.map(att => {
              return tx.attachment.create({ data: {
                filename: att.filename || att.fileName || 'file',
                originalName: att.originalName || att.originalFileName || att.filename,
                mimeType: att.mimeType || att.fileType,
                size: att.size || att.fileSize || 0,
                url: att.url || att.fileUrl,
                uploaderId: socket.userId,
                messageId: createdMessage.id
              } });
            }));
          }
          await tx.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date(), lastMessageAt: new Date(), lastMessageId: createdMessage.id } });
          const full = await tx.message.findUnique({ where: { id: createdMessage.id }, include: { sender: { select: { id: true, username: true, firstName: true, lastName: true, profileImageUrl: true, isVerified: true } }, attachments: true } });
          return full;
        });

        socket.to(`conversation_${conversationId}`).emit('new_message', { ...result, author: result.sender, conversationId });
        socket.emit('message_sent', { ...result, author: result.sender, conversationId });
      } catch (err) {
        console.error('send_message handler error:', err);
        socket.emit('message_error', { error: 'Failed to send message' });
      }
    });

    socket.on('typing_start', (conversationId) => socket.to(`conversation_${conversationId}`).emit('user_typing', { userId: socket.userId, username: socket.user.username, isTyping: true }));
    socket.on('typing_stop', (conversationId) => socket.to(`conversation_${conversationId}`).emit('user_typing', { userId: socket.userId, username: socket.user.username, isTyping: false }));

    socket.on('mark_message_read', async (data) => {
      try {
        const { messageId, conversationId } = data;
        const prisma = getPrismaClient();
        await prisma.messageRead.upsert({ where: { messageId_userId: { messageId, userId: socket.userId } }, update: { readAt: new Date() }, create: { messageId, userId: socket.userId, readAt: new Date() } });
        socket.to(`conversation_${conversationId}`).emit('message_read', { messageId, userId: socket.userId, readAt: new Date() });
      } catch (err) { console.error('mark_message_read error:', err); }
    });

    socket.on('disconnect', () => {
      console.log(`🔌 User ${socket.userId} disconnected`);
    });
  });
}

module.exports = { registerSocketHandlers };
