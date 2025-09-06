const Chat = require('../models/Chat');
const User = require('../models/User');
const Message = require('../models/Message');
const { v4: uuidv4 } = require('uuid');
const { getIO } = require('../config/socket');

class ChatController {
  // Create a new chat
  async createChat(req, res) {
    try {
      const { type, name, description, participantIds, isPublic = false, collegeId } = req.body;
      const userId = req.user.userId;

      // Validate participants exist
      const participants = await User.find({ 
        userId: { $in: [...participantIds, userId] } 
      });

      if (participants.length !== participantIds.length + 1) {
        return res.status(400).json({
          success: false,
          message: 'Some participants not found'
        });
      }

      // For direct chats, check if already exists
      if (type === 'direct' && participantIds.length === 1) {
        const existingChat = await Chat.findDirectChat(userId, participantIds[0]);
        if (existingChat) {
          return res.status(200).json({
            success: true,
            data: existingChat
          });
        }
      }

      // Create chat
      const chatId = uuidv4();
      const participantData = participants.map(user => ({
        userId: user.userId,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImage: user.profileImage,
        role: user.userId === userId ? 'owner' : 'member',
        joinedAt: new Date(),
        isActive: true
      }));

      const chat = new Chat({
        chatId,
        type,
        name: type === 'direct' ? null : name,
        description,
        participants: participantData,
        isPublic,
        collegeId: collegeId || req.user.collegeId,
        createdBy: {
          userId,
          username: req.user.username
        }
      });

      await chat.save();

      // Notify participants via WebSocket
      const io = getIO();
      participantIds.forEach(participantId => {
        io.to(`user:${participantId}`).emit('chat:created', {
          chat: chat.toJSON()
        });
      });

      res.status(201).json({
        success: true,
        data: chat
      });
    } catch (error) {
      console.error('Create chat error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create chat',
        error: error.message
      });
    }
  }

  // Get user's chats
  async getUserChats(req, res) {
    try {
      const userId = req.user.userId;
      const { type, limit = 20, offset = 0 } = req.query;

      let query = {
        'participants.userId': userId,
        'participants.isActive': true,
        isActive: true
      };

      if (type) {
        query.type = type;
      }

      const chats = await Chat.find(query)
        .sort({ 'lastMessage.timestamp': -1 })
        .limit(parseInt(limit))
        .skip(parseInt(offset));

      res.json({
        success: true,
        data: chats,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: await Chat.countDocuments(query)
        }
      });
    } catch (error) {
      console.error('Get user chats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get chats',
        error: error.message
      });
    }
  }

  // Get public chats
  async getPublicChats(req, res) {
    try {
      const { collegeId, limit = 20 } = req.query;
      const userCollegeId = collegeId || req.user.collegeId;

      const chats = await Chat.findPublicGroups(userCollegeId, parseInt(limit));

      res.json({
        success: true,
        data: chats
      });
    } catch (error) {
      console.error('Get public chats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get public chats',
        error: error.message
      });
    }
  }

  // Search chats
  async searchChats(req, res) {
    try {
      const userId = req.user.userId;
      const { q: query, limit = 10 } = req.query;

      const chats = await Chat.searchChats(userId, query, parseInt(limit));

      res.json({
        success: true,
        data: chats
      });
    } catch (error) {
      console.error('Search chats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to search chats',
        error: error.message
      });
    }
  }

  // Get chat details
  async getChatDetails(req, res) {
    try {
      const { chatId } = req.params;
      const userId = req.user.userId;

      const chat = await Chat.findOne({ chatId });

      if (!chat) {
        return res.status(404).json({
          success: false,
          message: 'Chat not found'
        });
      }

      // Check if user is participant
      if (!chat.isParticipant(userId)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      res.json({
        success: true,
        data: chat
      });
    } catch (error) {
      console.error('Get chat details error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get chat details',
        error: error.message
      });
    }
  }

  // Update chat
  async updateChat(req, res) {
    try {
      const { chatId } = req.params;
      const userId = req.user.userId;
      const { name, description, settings } = req.body;

      const chat = await Chat.findOne({ chatId });

      if (!chat) {
        return res.status(404).json({
          success: false,
          message: 'Chat not found'
        });
      }

      // Check permissions
      if (!chat.isAdmin(userId)) {
        return res.status(403).json({
          success: false,
          message: 'Admin permissions required'
        });
      }

      // Update fields
      if (name !== undefined) chat.name = name;
      if (description !== undefined) chat.description = description;
      if (settings) {
        chat.settings = { ...chat.settings, ...settings };
      }

      await chat.save();

      // Notify participants
      const io = getIO();
      chat.getActiveParticipants().forEach(participant => {
        io.to(`user:${participant.userId}`).emit('chat:updated', {
          chatId,
          updates: { name, description, settings }
        });
      });

      res.json({
        success: true,
        data: chat
      });
    } catch (error) {
      console.error('Update chat error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update chat',
        error: error.message
      });
    }
  }

  // Delete chat
  async deleteChat(req, res) {
    try {
      const { chatId } = req.params;
      const userId = req.user.userId;

      const chat = await Chat.findOne({ chatId });

      if (!chat) {
        return res.status(404).json({
          success: false,
          message: 'Chat not found'
        });
      }

      // Check if user is owner
      const userParticipant = chat.participants.find(p => p.userId === userId);
      if (!userParticipant || userParticipant.role !== 'owner') {
        return res.status(403).json({
          success: false,
          message: 'Owner permissions required'
        });
      }

      // Mark as inactive instead of deleting
      chat.isActive = false;
      await chat.save();

      // Notify participants
      const io = getIO();
      chat.getActiveParticipants().forEach(participant => {
        io.to(`user:${participant.userId}`).emit('chat:deleted', {
          chatId
        });
      });

      res.json({
        success: true,
        message: 'Chat deleted successfully'
      });
    } catch (error) {
      console.error('Delete chat error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete chat',
        error: error.message
      });
    }
  }

  // Add participants
  async addParticipants(req, res) {
    try {
      const { chatId } = req.params;
      const { userIds, role = 'member' } = req.body;
      const userId = req.user.userId;

      const chat = await Chat.findOne({ chatId });

      if (!chat) {
        return res.status(404).json({
          success: false,
          message: 'Chat not found'
        });
      }

      // Check permissions
      if (!chat.isAdmin(userId)) {
        return res.status(403).json({
          success: false,
          message: 'Admin permissions required'
        });
      }

      // Get user details
      const users = await User.find({ userId: { $in: userIds } });

      if (users.length !== userIds.length) {
        return res.status(400).json({
          success: false,
          message: 'Some users not found'
        });
      }

      // Add participants
      for (const user of users) {
        await chat.addParticipant(user, role);
      }

      // Notify new participants
      const io = getIO();
      userIds.forEach(newUserId => {
        io.to(`user:${newUserId}`).emit('chat:invited', {
          chat: chat.toJSON()
        });
      });

      // Notify existing participants
      chat.getActiveParticipants()
        .filter(p => !userIds.includes(p.userId))
        .forEach(participant => {
          io.to(`user:${participant.userId}`).emit('chat:participants_added', {
            chatId,
            newParticipants: users.map(u => ({
              userId: u.userId,
              username: u.username,
              firstName: u.firstName,
              lastName: u.lastName
            }))
          });
        });

      res.json({
        success: true,
        message: 'Participants added successfully'
      });
    } catch (error) {
      console.error('Add participants error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to add participants',
        error: error.message
      });
    }
  }

  // Remove participant
  async removeParticipant(req, res) {
    try {
      const { chatId, userId: targetUserId } = req.params;
      const userId = req.user.userId;

      const chat = await Chat.findOne({ chatId });

      if (!chat) {
        return res.status(404).json({
          success: false,
          message: 'Chat not found'
        });
      }

      // Check permissions (admin can remove others, users can remove themselves)
      if (targetUserId !== userId && !chat.isAdmin(userId)) {
        return res.status(403).json({
          success: false,
          message: 'Permission denied'
        });
      }

      await chat.removeParticipant(targetUserId);

      // Notify participants
      const io = getIO();
      chat.getActiveParticipants().forEach(participant => {
        io.to(`user:${participant.userId}`).emit('chat:participant_removed', {
          chatId,
          removedUserId: targetUserId
        });
      });

      // Notify removed user
      io.to(`user:${targetUserId}`).emit('chat:removed', {
        chatId
      });

      res.json({
        success: true,
        message: 'Participant removed successfully'
      });
    } catch (error) {
      console.error('Remove participant error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to remove participant',
        error: error.message
      });
    }
  }

  // Update participant role
  async updateParticipantRole(req, res) {
    try {
      const { chatId, userId: targetUserId } = req.params;
      const { role } = req.body;
      const userId = req.user.userId;

      const chat = await Chat.findOne({ chatId });

      if (!chat) {
        return res.status(404).json({
          success: false,
          message: 'Chat not found'
        });
      }

      // Check permissions (only owner can change roles)
      const userParticipant = chat.participants.find(p => p.userId === userId);
      if (!userParticipant || userParticipant.role !== 'owner') {
        return res.status(403).json({
          success: false,
          message: 'Owner permissions required'
        });
      }

      await chat.updateParticipantRole(targetUserId, role);

      // Notify participants
      const io = getIO();
      chat.getActiveParticipants().forEach(participant => {
        io.to(`user:${participant.userId}`).emit('chat:role_updated', {
          chatId,
          userId: targetUserId,
          newRole: role
        });
      });

      res.json({
        success: true,
        message: 'Role updated successfully'
      });
    } catch (error) {
      console.error('Update participant role error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update role',
        error: error.message
      });
    }
  }

  // Get participants
  async getParticipants(req, res) {
    try {
      const { chatId } = req.params;
      const userId = req.user.userId;

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

      const activeParticipants = chat.getActiveParticipants();

      res.json({
        success: true,
        data: activeParticipants
      });
    } catch (error) {
      console.error('Get participants error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get participants',
        error: error.message
      });
    }
  }

  // Pin message
  async pinMessage(req, res) {
    try {
      const { chatId, messageId } = req.params;
      const userId = req.user.userId;

      const chat = await Chat.findOne({ chatId });

      if (!chat) {
        return res.status(404).json({
          success: false,
          message: 'Chat not found'
        });
      }

      if (!chat.isAdmin(userId)) {
        return res.status(403).json({
          success: false,
          message: 'Admin permissions required'
        });
      }

      // Verify message exists
      const message = await Message.findOne({ messageId, chatId });
      if (!message) {
        return res.status(404).json({
          success: false,
          message: 'Message not found'
        });
      }

      await chat.pinMessage(messageId, userId);

      // Notify participants
      const io = getIO();
      chat.getActiveParticipants().forEach(participant => {
        io.to(`user:${participant.userId}`).emit('message:pinned', {
          chatId,
          messageId,
          pinnedBy: userId
        });
      });

      res.json({
        success: true,
        message: 'Message pinned successfully'
      });
    } catch (error) {
      console.error('Pin message error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to pin message',
        error: error.message
      });
    }
  }

  // Unpin message
  async unpinMessage(req, res) {
    try {
      const { chatId, messageId } = req.params;
      const userId = req.user.userId;

      const chat = await Chat.findOne({ chatId });

      if (!chat) {
        return res.status(404).json({
          success: false,
          message: 'Chat not found'
        });
      }

      if (!chat.isAdmin(userId)) {
        return res.status(403).json({
          success: false,
          message: 'Admin permissions required'
        });
      }

      await chat.unpinMessage(messageId);

      // Notify participants
      const io = getIO();
      chat.getActiveParticipants().forEach(participant => {
        io.to(`user:${participant.userId}`).emit('message:unpinned', {
          chatId,
          messageId
        });
      });

      res.json({
        success: true,
        message: 'Message unpinned successfully'
      });
    } catch (error) {
      console.error('Unpin message error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to unpin message',
        error: error.message
      });
    }
  }

  // Get pinned messages
  async getPinnedMessages(req, res) {
    try {
      const { chatId } = req.params;
      const userId = req.user.userId;

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

      // Get full message details for pinned messages
      const pinnedMessageIds = chat.pinnedMessages.map(pm => pm.messageId);
      const messages = await Message.find({
        messageId: { $in: pinnedMessageIds },
        chatId
      }).sort({ createdAt: -1 });

      res.json({
        success: true,
        data: messages
      });
    } catch (error) {
      console.error('Get pinned messages error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get pinned messages',
        error: error.message
      });
    }
  }

  // Archive chat
  async archiveChat(req, res) {
    try {
      const { chatId } = req.params;
      const userId = req.user.userId;

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

      chat.isArchived = true;
      await chat.save();

      res.json({
        success: true,
        message: 'Chat archived successfully'
      });
    } catch (error) {
      console.error('Archive chat error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to archive chat',
        error: error.message
      });
    }
  }

  // Unarchive chat
  async unarchiveChat(req, res) {
    try {
      const { chatId } = req.params;
      const userId = req.user.userId;

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

      chat.isArchived = false;
      await chat.save();

      res.json({
        success: true,
        message: 'Chat unarchived successfully'
      });
    } catch (error) {
      console.error('Unarchive chat error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to unarchive chat',
        error: error.message
      });
    }
  }
}

module.exports = new ChatController();
