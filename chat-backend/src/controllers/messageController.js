const Message = require('../models/Message');
const Chat = require('../models/Chat');
const User = require('../models/User');
const { v4: uuidv4 } = require('uuid');
const { getIO } = require('../config/socket');
const uploadService = require('../services/uploadService');
const multer = require('multer');

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    // Allow images, documents, and audio files
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'audio/mpeg', 'audio/wav', 'audio/ogg'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'), false);
    }
  }
});

class MessageController {
  // Send a message
  async sendMessage(req, res) {
    try {
      const { chatId } = req.params;
      const { content, replyTo, threadId } = req.body;
      const userId = req.user.userId;

      // Verify chat exists and user is participant
      const chat = await Chat.findOne({ chatId });
      if (!chat) {
        return res.status(404).json({
          success: false,
          message: 'Chat not found'
        });
      }

      if (!chat.isParticipant(userId)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      // Get sender info
      const sender = await User.findOne({ userId });
      if (!sender) {
        return res.status(404).json({
          success: false,
          message: 'Sender not found'
        });
      }

      // Create message
      const messageId = uuidv4();
      const message = new Message({
        messageId,
        chatId,
        sender: {
          userId: sender.userId,
          username: sender.username,
          firstName: sender.firstName,
          lastName: sender.lastName,
          profileImage: sender.profileImage
        },
        content,
        replyTo,
        threadId,
        timestamp: new Date()
      });

      await message.save();

      // Update chat's last message
      await chat.updateLastMessage(message);

      // Emit to all chat participants
      const io = getIO();
      chat.getActiveParticipants().forEach(participant => {
        io.to(`user:${participant.userId}`).emit('message:new', {
          message: message.toJSON()
        });
      });

      // Send push notifications (implement based on your notification service)
      // await notificationService.sendMessageNotification(chat, message);

      res.status(201).json({
        success: true,
        data: message
      });
    } catch (error) {
      console.error('Send message error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to send message',
        error: error.message
      });
    }
  }

  // Get messages
  async getMessages(req, res) {
    try {
      const { chatId } = req.params;
      const { limit = 50, before, after } = req.query;
      const userId = req.user.userId;

      // Verify chat exists and user is participant
      const chat = await Chat.findOne({ chatId });
      if (!chat) {
        return res.status(404).json({
          success: false,
          message: 'Chat not found'
        });
      }

      if (!chat.isParticipant(userId)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      // Build query
      let query = { chatId, isDeleted: false };

      if (before) {
        query.timestamp = { $lt: new Date(before) };
      } else if (after) {
        query.timestamp = { $gt: new Date(after) };
      }

      const messages = await Message.find(query)
        .sort({ timestamp: -1 })
        .limit(parseInt(limit));

      // Reverse to show oldest first
      messages.reverse();

      res.json({
        success: true,
        data: messages,
        pagination: {
          limit: parseInt(limit),
          hasMore: messages.length === parseInt(limit)
        }
      });
    } catch (error) {
      console.error('Get messages error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get messages',
        error: error.message
      });
    }
  }

  // Get single message
  async getMessage(req, res) {
    try {
      const { chatId, messageId } = req.params;
      const userId = req.user.userId;

      // Verify chat access
      const chat = await Chat.findOne({ chatId });
      if (!chat || !chat.isParticipant(userId)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      const message = await Message.findOne({ messageId, chatId });
      if (!message) {
        return res.status(404).json({
          success: false,
          message: 'Message not found'
        });
      }

      res.json({
        success: true,
        data: message
      });
    } catch (error) {
      console.error('Get message error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get message',
        error: error.message
      });
    }
  }

  // Edit message
  async editMessage(req, res) {
    try {
      const { chatId, messageId } = req.params;
      const { content } = req.body;
      const userId = req.user.userId;

      const message = await Message.findOne({ messageId, chatId });
      if (!message) {
        return res.status(404).json({
          success: false,
          message: 'Message not found'
        });
      }

      // Check if user is the sender
      if (message.sender.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Can only edit your own messages'
        });
      }

      // Check if message is too old to edit (e.g., 24 hours)
      const editTimeLimit = 24 * 60 * 60 * 1000; // 24 hours
      if (Date.now() - message.timestamp.getTime() > editTimeLimit) {
        return res.status(400).json({
          success: false,
          message: 'Message too old to edit'
        });
      }

      // Update message
      message.content = content;
      message.isEdited = true;
      message.editedAt = new Date();
      await message.save();

      // Notify participants
      const chat = await Chat.findOne({ chatId });
      const io = getIO();
      chat.getActiveParticipants().forEach(participant => {
        io.to(`user:${participant.userId}`).emit('message:edited', {
          messageId,
          chatId,
          content,
          editedAt: message.editedAt
        });
      });

      res.json({
        success: true,
        data: message
      });
    } catch (error) {
      console.error('Edit message error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to edit message',
        error: error.message
      });
    }
  }

  // Delete message
  async deleteMessage(req, res) {
    try {
      const { chatId, messageId } = req.params;
      const userId = req.user.userId;

      const message = await Message.findOne({ messageId, chatId });
      if (!message) {
        return res.status(404).json({
          success: false,
          message: 'Message not found'
        });
      }

      const chat = await Chat.findOne({ chatId });

      // Check permissions (sender or admin)
      if (message.sender.userId !== userId && !chat.isAdmin(userId)) {
        return res.status(403).json({
          success: false,
          message: 'Permission denied'
        });
      }

      // Soft delete
      message.isDeleted = true;
      message.deletedAt = new Date();
      message.deletedBy = userId;
      await message.save();

      // Notify participants
      const io = getIO();
      chat.getActiveParticipants().forEach(participant => {
        io.to(`user:${participant.userId}`).emit('message:deleted', {
          messageId,
          chatId,
          deletedBy: userId
        });
      });

      res.json({
        success: true,
        message: 'Message deleted successfully'
      });
    } catch (error) {
      console.error('Delete message error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete message',
        error: error.message
      });
    }
  }

  // Add reaction
  async addReaction(req, res) {
    try {
      const { chatId, messageId } = req.params;
      const { emoji } = req.body;
      const userId = req.user.userId;

      const message = await Message.findOne({ messageId, chatId });
      if (!message) {
        return res.status(404).json({
          success: false,
          message: 'Message not found'
        });
      }

      // Verify chat access
      const chat = await Chat.findOne({ chatId });
      if (!chat.isParticipant(userId)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      await message.addReaction(userId, emoji);

      // Notify participants
      const io = getIO();
      chat.getActiveParticipants().forEach(participant => {
        io.to(`user:${participant.userId}`).emit('message:reaction_added', {
          messageId,
          chatId,
          userId,
          emoji
        });
      });

      res.json({
        success: true,
        message: 'Reaction added successfully'
      });
    } catch (error) {
      console.error('Add reaction error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to add reaction',
        error: error.message
      });
    }
  }

  // Remove reaction
  async removeReaction(req, res) {
    try {
      const { chatId, messageId, emoji } = req.params;
      const userId = req.user.userId;

      const message = await Message.findOne({ messageId, chatId });
      if (!message) {
        return res.status(404).json({
          success: false,
          message: 'Message not found'
        });
      }

      await message.removeReaction(userId, emoji);

      // Notify participants
      const chat = await Chat.findOne({ chatId });
      const io = getIO();
      chat.getActiveParticipants().forEach(participant => {
        io.to(`user:${participant.userId}`).emit('message:reaction_removed', {
          messageId,
          chatId,
          userId,
          emoji
        });
      });

      res.json({
        success: true,
        message: 'Reaction removed successfully'
      });
    } catch (error) {
      console.error('Remove reaction error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to remove reaction',
        error: error.message
      });
    }
  }

  // Mark message as read
  async markAsRead(req, res) {
    try {
      const { chatId, messageId } = req.params;
      const userId = req.user.userId;

      const message = await Message.findOne({ messageId, chatId });
      if (!message) {
        return res.status(404).json({
          success: false,
          message: 'Message not found'
        });
      }

      await message.markAsRead(userId);

      // Notify sender about read receipt
      const io = getIO();
      io.to(`user:${message.sender.userId}`).emit('message:read', {
        messageId,
        chatId,
        readBy: userId,
        readAt: new Date()
      });

      res.json({
        success: true,
        message: 'Message marked as read'
      });
    } catch (error) {
      console.error('Mark as read error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to mark as read',
        error: error.message
      });
    }
  }

  // Mark all messages as read
  async markAllAsRead(req, res) {
    try {
      const { chatId } = req.params;
      const userId = req.user.userId;

      // Verify chat access
      const chat = await Chat.findOne({ chatId });
      if (!chat.isParticipant(userId)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      // Mark all unread messages as read
      await Message.updateMany(
        {
          chatId,
          'readBy.userId': { $ne: userId },
          'sender.userId': { $ne: userId }
        },
        {
          $push: {
            readBy: {
              userId,
              readAt: new Date()
            }
          }
        }
      );

      res.json({
        success: true,
        message: 'All messages marked as read'
      });
    } catch (error) {
      console.error('Mark all as read error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to mark all as read',
        error: error.message
      });
    }
  }

  // File upload
  async uploadFile(req, res) {
    try {
      const { chatId } = req.params;
      const userId = req.user.userId;

      // Verify chat access
      const chat = await Chat.findOne({ chatId });
      if (!chat || !chat.isParticipant(userId)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      // Use multer middleware
      upload.single('file')(req, res, async (err) => {
        if (err) {
          return res.status(400).json({
            success: false,
            message: err.message
          });
        }

        if (!req.file) {
          return res.status(400).json({
            success: false,
            message: 'No file uploaded'
          });
        }

        try {
          // Upload to S3 (or your storage service)
          const fileUrl = await uploadService.uploadChatFile(req.file, chatId);

          // Create file message
          const messageId = uuidv4();
          const sender = await User.findOne({ userId });

          const message = new Message({
            messageId,
            chatId,
            sender: {
              userId: sender.userId,
              username: sender.username,
              firstName: sender.firstName,
              lastName: sender.lastName,
              profileImage: sender.profileImage
            },
            content: {
              type: req.file.mimetype.startsWith('image/') ? 'image' : 'file',
              url: fileUrl,
              filename: req.file.originalname,
              size: req.file.size,
              mimeType: req.file.mimetype
            },
            timestamp: new Date()
          });

          await message.save();
          await chat.updateLastMessage(message);

          // Notify participants
          const io = getIO();
          chat.getActiveParticipants().forEach(participant => {
            io.to(`user:${participant.userId}`).emit('message:new', {
              message: message.toJSON()
            });
          });

          res.json({
            success: true,
            data: message
          });
        } catch (uploadError) {
          console.error('File upload error:', uploadError);
          res.status(500).json({
            success: false,
            message: 'Failed to upload file',
            error: uploadError.message
          });
        }
      });
    } catch (error) {
      console.error('Upload file error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to process upload',
        error: error.message
      });
    }
  }

  // Set typing status
  async setTypingStatus(req, res) {
    try {
      const { chatId } = req.params;
      const { isTyping } = req.body;
      const userId = req.user.userId;

      // Verify chat access
      const chat = await Chat.findOne({ chatId });
      if (!chat || !chat.isParticipant(userId)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      // Notify other participants via WebSocket
      const io = getIO();
      chat.getActiveParticipants()
        .filter(p => p.userId !== userId)
        .forEach(participant => {
          io.to(`user:${participant.userId}`).emit('typing:update', {
            chatId,
            userId,
            isTyping,
            timestamp: new Date()
          });
        });

      res.json({
        success: true,
        message: 'Typing status updated'
      });
    } catch (error) {
      console.error('Set typing status error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update typing status',
        error: error.message
      });
    }
  }
}

module.exports = new MessageController();
