const User = require('../models/User');
const Chat = require('../models/Chat');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { getIO } = require('../config/socket');

class UserController {
  // Get user profile
  async getProfile(req, res) {
    try {
      const userId = req.user.userId;
      
      const user = await User.findOne({ userId });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Remove sensitive data
      const userProfile = user.toJSON();
      delete userProfile.password;
      delete userProfile.refreshTokens;

      res.json({
        success: true,
        data: userProfile
      });
    } catch (error) {
      console.error('Get profile error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get profile',
        error: error.message
      });
    }
  }

  // Update user profile
  async updateProfile(req, res) {
    try {
      const userId = req.user.userId;
      const { firstName, lastName, bio, status, profileImage } = req.body;

      const user = await User.findOne({ userId });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Update fields
      if (firstName !== undefined) user.firstName = firstName;
      if (lastName !== undefined) user.lastName = lastName;
      if (bio !== undefined) user.bio = bio;
      if (status !== undefined) {
        user.status = {
          text: status,
          emoji: req.body.statusEmoji || user.status.emoji,
          expiresAt: req.body.statusExpiresAt ? new Date(req.body.statusExpiresAt) : null
        };
      }
      if (profileImage !== undefined) user.profileImage = profileImage;

      user.updatedAt = new Date();
      await user.save();

      // Update profile in all chats
      await Chat.updateMany(
        { 'participants.userId': userId },
        {
          $set: {
            'participants.$.firstName': user.firstName,
            'participants.$.lastName': user.lastName,
            'participants.$.profileImage': user.profileImage
          }
        }
      );

      // Notify contacts about profile update
      const io = getIO();
      user.contacts
        .filter(contact => contact.status === 'accepted')
        .forEach(contact => {
          io.to(`user:${contact.userId}`).emit('user:profile_updated', {
            userId,
            updates: { firstName, lastName, profileImage }
          });
        });

      const updatedUser = user.toJSON();
      delete updatedUser.password;
      delete updatedUser.refreshTokens;

      res.json({
        success: true,
        data: updatedUser
      });
    } catch (error) {
      console.error('Update profile error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update profile',
        error: error.message
      });
    }
  }

  // Update privacy settings
  async updatePrivacySettings(req, res) {
    try {
      const userId = req.user.userId;
      const privacyUpdates = req.body;

      const user = await User.findOne({ userId });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Update privacy settings
      user.privacy = { ...user.privacy, ...privacyUpdates };
      user.updatedAt = new Date();
      await user.save();

      res.json({
        success: true,
        data: user.privacy
      });
    } catch (error) {
      console.error('Update privacy settings error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update privacy settings',
        error: error.message
      });
    }
  }

  // Search users
  async searchUsers(req, res) {
    try {
      const { q: query, type = 'username', collegeId, limit = 20 } = req.query;
      const userId = req.user.userId;

      let searchQuery = {
        userId: { $ne: userId }, // Exclude self
        isActive: true
      };

      // Add college filter if specified
      if (collegeId) {
        searchQuery.collegeId = collegeId;
      }

      // Build search based on type
      switch (type) {
        case 'username':
          searchQuery.username = { $regex: query, $options: 'i' };
          break;
        case 'name':
          searchQuery.$or = [
            { firstName: { $regex: query, $options: 'i' } },
            { lastName: { $regex: query, $options: 'i' } },
            { 
              $expr: {
                $regexMatch: {
                  input: { $concat: ['$firstName', ' ', '$lastName'] },
                  regex: query,
                  options: 'i'
                }
              }
            }
          ];
          break;
        case 'college':
          searchQuery['college.name'] = { $regex: query, $options: 'i' };
          break;
        default:
          searchQuery.$or = [
            { username: { $regex: query, $options: 'i' } },
            { firstName: { $regex: query, $options: 'i' } },
            { lastName: { $regex: query, $options: 'i' } }
          ];
      }

      const users = await User.find(searchQuery)
        .select('userId username firstName lastName profileImage college isOnline lastSeen')
        .limit(parseInt(limit));

      res.json({
        success: true,
        data: users
      });
    } catch (error) {
      console.error('Search users error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to search users',
        error: error.message
      });
    }
  }

  // Get user suggestions
  async getUserSuggestions(req, res) {
    try {
      const userId = req.user.userId;
      const { limit = 10 } = req.query;

      const user = await User.findOne({ userId });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Get suggestions based on college and mutual connections
      const contactUserIds = user.contacts
        .filter(c => c.status === 'accepted')
        .map(c => c.userId);

      const suggestions = await User.find({
        userId: { 
          $ne: userId,
          $nin: [...contactUserIds, ...user.contacts.map(c => c.userId)]
        },
        collegeId: user.collegeId,
        isActive: true
      })
      .select('userId username firstName lastName profileImage college')
      .limit(parseInt(limit));

      res.json({
        success: true,
        data: suggestions
      });
    } catch (error) {
      console.error('Get user suggestions error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get suggestions',
        error: error.message
      });
    }
  }

  // Get contacts
  async getContacts(req, res) {
    try {
      const userId = req.user.userId;
      const { status = 'accepted', limit = 100 } = req.query;

      const user = await User.findOne({ userId });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      let contacts = user.contacts.filter(contact => contact.status === status);

      if (status === 'accepted') {
        // Get full user details for accepted contacts
        const contactUserIds = contacts.map(c => c.userId);
        const contactUsers = await User.find({
          userId: { $in: contactUserIds }
        })
        .select('userId username firstName lastName profileImage isOnline lastSeen');

        contacts = contacts.map(contact => {
          const userDetails = contactUsers.find(u => u.userId === contact.userId);
          return {
            ...contact.toObject(),
            ...userDetails?.toObject()
          };
        });
      }

      res.json({
        success: true,
        data: contacts.slice(0, parseInt(limit))
      });
    } catch (error) {
      console.error('Get contacts error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get contacts',
        error: error.message
      });
    }
  }

  // Send contact request
  async sendContactRequest(req, res) {
    try {
      const { userId: targetUserId, message } = req.body;
      const userId = req.user.userId;

      if (userId === targetUserId) {
        return res.status(400).json({
          success: false,
          message: 'Cannot send request to yourself'
        });
      }

      const [user, targetUser] = await Promise.all([
        User.findOne({ userId }),
        User.findOne({ userId: targetUserId })
      ]);

      if (!targetUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Check if already connected or request exists
      const existingContact = user.contacts.find(c => c.userId === targetUserId);
      if (existingContact) {
        return res.status(400).json({
          success: false,
          message: 'Contact request already exists or users are already connected'
        });
      }

      // Add to sender's contacts as 'sent'
      user.contacts.push({
        userId: targetUserId,
        status: 'sent',
        requestedAt: new Date(),
        message
      });

      // Add to receiver's contacts as 'pending'
      targetUser.contacts.push({
        userId,
        status: 'pending',
        requestedAt: new Date(),
        message
      });

      await Promise.all([user.save(), targetUser.save()]);

      // Notify target user
      const io = getIO();
      io.to(`user:${targetUserId}`).emit('contact:request_received', {
        from: {
          userId,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          profileImage: user.profileImage
        },
        message,
        requestedAt: new Date()
      });

      res.json({
        success: true,
        message: 'Contact request sent successfully'
      });
    } catch (error) {
      console.error('Send contact request error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to send contact request',
        error: error.message
      });
    }
  }

  // Accept contact request
  async acceptContactRequest(req, res) {
    try {
      const { userId: senderUserId } = req.body;
      const userId = req.user.userId;

      const [user, senderUser] = await Promise.all([
        User.findOne({ userId }),
        User.findOne({ userId: senderUserId })
      ]);

      if (!senderUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Update contact status for both users
      const userContact = user.contacts.find(c => c.userId === senderUserId);
      const senderContact = senderUser.contacts.find(c => c.userId === userId);

      if (!userContact || userContact.status !== 'pending') {
        return res.status(400).json({
          success: false,
          message: 'No pending contact request found'
        });
      }

      userContact.status = 'accepted';
      userContact.acceptedAt = new Date();

      if (senderContact) {
        senderContact.status = 'accepted';
        senderContact.acceptedAt = new Date();
      }

      await Promise.all([user.save(), senderUser.save()]);

      // Notify sender
      const io = getIO();
      io.to(`user:${senderUserId}`).emit('contact:request_accepted', {
        by: {
          userId,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          profileImage: user.profileImage
        },
        acceptedAt: new Date()
      });

      res.json({
        success: true,
        message: 'Contact request accepted'
      });
    } catch (error) {
      console.error('Accept contact request error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to accept contact request',
        error: error.message
      });
    }
  }

  // Decline contact request
  async declineContactRequest(req, res) {
    try {
      const { userId: senderUserId } = req.body;
      const userId = req.user.userId;

      const [user, senderUser] = await Promise.all([
        User.findOne({ userId }),
        User.findOne({ userId: senderUserId })
      ]);

      // Remove contact from both users
      user.contacts = user.contacts.filter(c => c.userId !== senderUserId);
      if (senderUser) {
        senderUser.contacts = senderUser.contacts.filter(c => c.userId !== userId);
      }

      await Promise.all([user.save(), senderUser?.save()]);

      res.json({
        success: true,
        message: 'Contact request declined'
      });
    } catch (error) {
      console.error('Decline contact request error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to decline contact request',
        error: error.message
      });
    }
  }

  // Remove contact
  async removeContact(req, res) {
    try {
      const { userId: contactUserId } = req.params;
      const userId = req.user.userId;

      const [user, contactUser] = await Promise.all([
        User.findOne({ userId }),
        User.findOne({ userId: contactUserId })
      ]);

      // Remove from both users
      user.contacts = user.contacts.filter(c => c.userId !== contactUserId);
      if (contactUser) {
        contactUser.contacts = contactUser.contacts.filter(c => c.userId !== userId);
      }

      await Promise.all([user.save(), contactUser?.save()]);

      // Notify contact
      const io = getIO();
      io.to(`user:${contactUserId}`).emit('contact:removed', {
        by: userId
      });

      res.json({
        success: true,
        message: 'Contact removed successfully'
      });
    } catch (error) {
      console.error('Remove contact error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to remove contact',
        error: error.message
      });
    }
  }

  // Block user
  async blockUser(req, res) {
    try {
      const { userId: targetUserId, reason } = req.body;
      const userId = req.user.userId;

      const user = await User.findOne({ userId });

      // Add to blocked list
      const existingBlock = user.blockedUsers.find(b => b.userId === targetUserId);
      if (existingBlock) {
        return res.status(400).json({
          success: false,
          message: 'User already blocked'
        });
      }

      user.blockedUsers.push({
        userId: targetUserId,
        reason,
        blockedAt: new Date()
      });

      // Remove from contacts if exists
      user.contacts = user.contacts.filter(c => c.userId !== targetUserId);

      await user.save();

      res.json({
        success: true,
        message: 'User blocked successfully'
      });
    } catch (error) {
      console.error('Block user error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to block user',
        error: error.message
      });
    }
  }

  // Unblock user
  async unblockUser(req, res) {
    try {
      const { userId: targetUserId } = req.body;
      const userId = req.user.userId;

      const user = await User.findOne({ userId });

      user.blockedUsers = user.blockedUsers.filter(b => b.userId !== targetUserId);
      await user.save();

      res.json({
        success: true,
        message: 'User unblocked successfully'
      });
    } catch (error) {
      console.error('Unblock user error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to unblock user',
        error: error.message
      });
    }
  }

  // Get blocked users
  async getBlockedUsers(req, res) {
    try {
      const userId = req.user.userId;
      const { limit = 50 } = req.query;

      const user = await User.findOne({ userId });
      const blockedUsers = user.blockedUsers.slice(0, parseInt(limit));

      res.json({
        success: true,
        data: blockedUsers
      });
    } catch (error) {
      console.error('Get blocked users error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get blocked users',
        error: error.message
      });
    }
  }

  // Set status
  async setStatus(req, res) {
    try {
      const userId = req.user.userId;
      const { status, emoji, expiresAt } = req.body;

      const user = await User.findOne({ userId });
      user.status = {
        text: status,
        emoji,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        updatedAt: new Date()
      };

      await user.save();

      // Notify contacts
      const io = getIO();
      user.contacts
        .filter(contact => contact.status === 'accepted')
        .forEach(contact => {
          io.to(`user:${contact.userId}`).emit('user:status_updated', {
            userId,
            status: user.status
          });
        });

      res.json({
        success: true,
        data: user.status
      });
    } catch (error) {
      console.error('Set status error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to set status',
        error: error.message
      });
    }
  }

  // Update presence
  async updatePresence(req, res) {
    try {
      const userId = req.user.userId;
      const { isOnline, lastSeen } = req.body;

      const user = await User.findOne({ userId });
      user.isOnline = isOnline;
      if (lastSeen) user.lastSeen = new Date(lastSeen);
      if (!isOnline && !lastSeen) user.lastSeen = new Date();

      await user.save();

      // Notify contacts about presence change
      const io = getIO();
      user.contacts
        .filter(contact => contact.status === 'accepted')
        .forEach(contact => {
          io.to(`user:${contact.userId}`).emit('user:presence_updated', {
            userId,
            isOnline,
            lastSeen: user.lastSeen
          });
        });

      res.json({
        success: true,
        message: 'Presence updated successfully'
      });
    } catch (error) {
      console.error('Update presence error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update presence',
        error: error.message
      });
    }
  }

  // Get user details (public)
  async getUserDetails(req, res) {
    try {
      const { userId: targetUserId } = req.params;
      const userId = req.user.userId;

      const user = await User.findOne({ userId: targetUserId })
        .select('userId username firstName lastName profileImage college isOnline lastSeen bio status');

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Check privacy settings
      const currentUser = await User.findOne({ userId });
      const isContact = currentUser.contacts.some(
        c => c.userId === targetUserId && c.status === 'accepted'
      );

      // Filter data based on privacy settings
      let userData = user.toJSON();

      if (user.privacy.profileVisibility === 'private' && !isContact) {
        userData = {
          userId: userData.userId,
          username: userData.username,
          firstName: userData.firstName,
          lastName: userData.lastName,
          profileImage: userData.profileImage
        };
      } else if (user.privacy.profileVisibility === 'college' && 
                 currentUser.collegeId !== user.collegeId && !isContact) {
        userData = {
          userId: userData.userId,
          username: userData.username,
          firstName: userData.firstName,
          lastName: userData.lastName,
          profileImage: userData.profileImage
        };
      }

      res.json({
        success: true,
        data: userData
      });
    } catch (error) {
      console.error('Get user details error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get user details',
        error: error.message
      });
    }
  }

  // Additional methods would continue here...
  // verifyCollege, getCollegeMembers, getNotificationSettings, etc.
  // Due to length constraints, I'm providing the core functionality

  // Get notification settings
  async getNotificationSettings(req, res) {
    try {
      const userId = req.user.userId;
      const user = await User.findOne({ userId });

      res.json({
        success: true,
        data: user.notificationSettings
      });
    } catch (error) {
      console.error('Get notification settings error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get notification settings',
        error: error.message
      });
    }
  }

  // Update notification settings
  async updateNotificationSettings(req, res) {
    try {
      const userId = req.user.userId;
      const settings = req.body;

      const user = await User.findOne({ userId });
      user.notificationSettings = { ...user.notificationSettings, ...settings };
      await user.save();

      res.json({
        success: true,
        data: user.notificationSettings
      });
    } catch (error) {
      console.error('Update notification settings error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update notification settings',
        error: error.message
      });
    }
  }

  // Placeholder methods for other endpoints
  async verifyCollege(req, res) {
    res.status(501).json({ success: false, message: 'Not implemented' });
  }

  async getCollegeMembers(req, res) {
    res.status(501).json({ success: false, message: 'Not implemented' });
  }

  async getDevices(req, res) {
    res.status(501).json({ success: false, message: 'Not implemented' });
  }

  async registerDevice(req, res) {
    res.status(501).json({ success: false, message: 'Not implemented' });
  }

  async removeDevice(req, res) {
    res.status(501).json({ success: false, message: 'Not implemented' });
  }

  async getUserActivity(req, res) {
    res.status(501).json({ success: false, message: 'Not implemented' });
  }

  async exportUserData(req, res) {
    res.status(501).json({ success: false, message: 'Not implemented' });
  }

  async deleteAccount(req, res) {
    res.status(501).json({ success: false, message: 'Not implemented' });
  }
}

module.exports = new UserController();
