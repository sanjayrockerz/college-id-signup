const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
  chatId: {
    type: String,
    required: true,
    unique: true
  },
  type: {
    type: String,
    enum: ['direct', 'group', 'channel'],
    required: true,
    default: 'direct'
  },
  
  // Chat participants
  participants: [{
    userId: {
      type: String,
      required: true
    },
    username: String,
    firstName: String,
    lastName: String,
    profileImage: String,
    role: {
      type: String,
      enum: ['member', 'admin', 'owner'],
      default: 'member'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    leftAt: Date,
    isActive: {
      type: Boolean,
      default: true
    },
    // Permissions for group chats
    permissions: {
      canSendMessages: {
        type: Boolean,
        default: true
      },
      canAddMembers: {
        type: Boolean,
        default: false
      },
      canEditInfo: {
        type: Boolean,
        default: false
      },
      canDeleteMessages: {
        type: Boolean,
        default: false
      }
    },
    // Notification settings per user
    notificationSettings: {
      muted: {
        type: Boolean,
        default: false
      },
      mutedUntil: Date,
      soundEnabled: {
        type: Boolean,
        default: true
      }
    }
  }],
  
  // Group/Channel specific info
  name: {
    type: String,
    maxlength: 100,
    trim: true
  },
  description: {
    type: String,
    maxlength: 500,
    trim: true
  },
  avatar: {
    type: String,
    default: null
  },
  
  // Chat settings
  settings: {
    // Who can add members
    whoCanAddMembers: {
      type: String,
      enum: ['everyone', 'admins', 'owner'],
      default: 'admins'
    },
    // Message history visibility for new members
    historyVisibility: {
      type: String,
      enum: ['visible', 'hidden'],
      default: 'visible'
    },
    // Disappearing messages
    disappearingMessages: {
      enabled: {
        type: Boolean,
        default: false
      },
      duration: {
        type: Number, // in seconds
        default: 86400 // 24 hours
      }
    },
    // File sharing
    allowFileSharing: {
      type: Boolean,
      default: true
    },
    maxFileSize: {
      type: Number,
      default: 10485760 // 10MB
    }
  },
  
  // Chat metadata
  lastMessage: {
    messageId: String,
    content: String,
    sender: {
      userId: String,
      username: String
    },
    timestamp: Date,
    type: String
  },
  
  // Message counters
  messageCount: {
    type: Number,
    default: 0
  },
  
  // Chat status
  isActive: {
    type: Boolean,
    default: true
  },
  isArchived: {
    type: Boolean,
    default: false
  },
  
  // Pinned messages
  pinnedMessages: [{
    messageId: String,
    pinnedBy: String,
    pinnedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // College/Community specific
  collegeId: String,
  isPublic: {
    type: Boolean,
    default: false
  },
  tags: [String],
  
  // Creation info
  createdBy: {
    userId: String,
    username: String
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      delete ret.__v;
      return ret;
    }
  }
});

// Indexes
chatSchema.index({ chatId: 1 });
chatSchema.index({ type: 1 });
chatSchema.index({ 'participants.userId': 1 });
chatSchema.index({ collegeId: 1, isPublic: 1 });
chatSchema.index({ isActive: 1 });
chatSchema.index({ 'lastMessage.timestamp': -1 });

// Instance methods
chatSchema.methods.addParticipant = function(userInfo, role = 'member') {
  const existingParticipant = this.participants.find(p => p.userId === userInfo.userId);
  
  if (existingParticipant) {
    // Reactivate if they were inactive
    existingParticipant.isActive = true;
    existingParticipant.leftAt = undefined;
  } else {
    this.participants.push({
      userId: userInfo.userId,
      username: userInfo.username,
      firstName: userInfo.firstName,
      lastName: userInfo.lastName,
      profileImage: userInfo.profileImage,
      role,
      joinedAt: new Date(),
      isActive: true
    });
  }
  
  return this.save();
};

chatSchema.methods.removeParticipant = function(userId) {
  const participant = this.participants.find(p => p.userId === userId);
  if (participant) {
    participant.isActive = false;
    participant.leftAt = new Date();
  }
  return this.save();
};

chatSchema.methods.updateParticipantRole = function(userId, newRole) {
  const participant = this.participants.find(p => p.userId === userId && p.isActive);
  if (participant) {
    participant.role = newRole;
  }
  return this.save();
};

chatSchema.methods.getActiveParticipants = function() {
  return this.participants.filter(p => p.isActive);
};

chatSchema.methods.isParticipant = function(userId) {
  return this.participants.some(p => p.userId === userId && p.isActive);
};

chatSchema.methods.isAdmin = function(userId) {
  const participant = this.participants.find(p => p.userId === userId && p.isActive);
  return participant && (participant.role === 'admin' || participant.role === 'owner');
};

chatSchema.methods.updateLastMessage = function(message) {
  this.lastMessage = {
    messageId: message.messageId,
    content: message.content.text || `[${message.content.type}]`,
    sender: {
      userId: message.sender.userId,
      username: message.sender.username
    },
    timestamp: message.createdAt || new Date(),
    type: message.content.type
  };
  this.messageCount += 1;
  return this.save();
};

chatSchema.methods.pinMessage = function(messageId, pinnedByUserId) {
  // Remove if already pinned
  this.pinnedMessages = this.pinnedMessages.filter(pm => pm.messageId !== messageId);
  
  // Add to pinned messages (limit to 10)
  if (this.pinnedMessages.length >= 10) {
    this.pinnedMessages.shift(); // Remove oldest
  }
  
  this.pinnedMessages.push({
    messageId,
    pinnedBy: pinnedByUserId,
    pinnedAt: new Date()
  });
  
  return this.save();
};

chatSchema.methods.unpinMessage = function(messageId) {
  this.pinnedMessages = this.pinnedMessages.filter(pm => pm.messageId !== messageId);
  return this.save();
};

// Static methods
chatSchema.statics.findUserChats = function(userId) {
  return this.find({
    'participants.userId': userId,
    'participants.isActive': true,
    isActive: true
  }).sort({ 'lastMessage.timestamp': -1 });
};

chatSchema.statics.findDirectChat = function(user1Id, user2Id) {
  return this.findOne({
    type: 'direct',
    'participants.userId': { $all: [user1Id, user2Id] },
    isActive: true
  });
};

chatSchema.statics.findPublicGroups = function(collegeId, limit = 20) {
  return this.find({
    type: 'group',
    collegeId,
    isPublic: true,
    isActive: true
  })
  .sort({ messageCount: -1 })
  .limit(limit);
};

chatSchema.statics.searchChats = function(userId, query, limit = 10) {
  return this.find({
    'participants.userId': userId,
    'participants.isActive': true,
    isActive: true,
    $or: [
      { name: { $regex: query, $options: 'i' } },
      { description: { $regex: query, $options: 'i' } },
      { 'participants.username': { $regex: query, $options: 'i' } }
    ]
  })
  .limit(limit)
  .sort({ 'lastMessage.timestamp': -1 });
};

module.exports = mongoose.model('Chat', chatSchema);
