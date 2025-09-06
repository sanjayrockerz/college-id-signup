const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  messageId: {
    type: String,
    required: true,
    unique: true
  },
  chatId: {
    type: String,
    required: true,
    index: true
  },
  sender: {
    userId: {
      type: String,
      required: true
    },
    username: {
      type: String,
      required: true
    },
    firstName: String,
    lastName: String,
    profileImage: String
  },
  
  // Message content
  content: {
    text: {
      type: String,
      maxlength: 4000
    },
    type: {
      type: String,
      enum: ['text', 'image', 'file', 'audio', 'video', 'location', 'contact', 'sticker', 'gif'],
      default: 'text'
    },
    metadata: {
      fileName: String,
      fileSize: Number,
      mimeType: String,
      duration: Number, // for audio/video
      dimensions: {
        width: Number,
        height: Number
      },
      thumbnail: String,
      location: {
        latitude: Number,
        longitude: Number,
        address: String
      }
    }
  },
  
  // File attachments
  attachments: [{
    url: String,
    s3Key: String,
    fileName: String,
    fileSize: Number,
    mimeType: String,
    thumbnail: String
  }],
  
  // Message status
  status: {
    type: String,
    enum: ['sending', 'sent', 'delivered', 'read', 'failed'],
    default: 'sent'
  },
  
  // Read receipts
  readBy: [{
    userId: String,
    readAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Message threading
  replyTo: {
    messageId: String,
    content: String,
    sender: String
  },
  
  // Reactions
  reactions: [{
    userId: String,
    emoji: String,
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Message flags
  isEdited: {
    type: Boolean,
    default: false
  },
  editHistory: [{
    content: String,
    editedAt: {
      type: Date,
      default: Date.now
    }
  }],
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: Date,
  isPinned: {
    type: Boolean,
    default: false
  },
  
  // Forwarding
  forwardedFrom: {
    messageId: String,
    originalSender: String,
    forwardedAt: {
      type: Date,
      default: Date.now
    }
  },
  
  // Mentions
  mentions: [{
    userId: String,
    username: String,
    startIndex: Number,
    endIndex: Number
  }],
  
  // Expiration (for disappearing messages)
  expiresAt: Date,
  
  // Client info
  clientInfo: {
    platform: String,
    version: String,
    userAgent: String
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

// Indexes for performance
messageSchema.index({ chatId: 1, createdAt: -1 });
messageSchema.index({ 'sender.userId': 1, createdAt: -1 });
messageSchema.index({ messageId: 1 });
messageSchema.index({ status: 1 });
messageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
messageSchema.index({ 'mentions.userId': 1 });

// Instance methods
messageSchema.methods.markAsRead = function(userId) {
  const existingRead = this.readBy.find(read => read.userId === userId);
  if (!existingRead) {
    this.readBy.push({ userId, readAt: new Date() });
  }
  return this.save();
};

messageSchema.methods.addReaction = function(userId, emoji) {
  // Remove existing reaction from this user
  this.reactions = this.reactions.filter(reaction => reaction.userId !== userId);
  
  // Add new reaction
  this.reactions.push({ userId, emoji, addedAt: new Date() });
  return this.save();
};

messageSchema.methods.removeReaction = function(userId) {
  this.reactions = this.reactions.filter(reaction => reaction.userId !== userId);
  return this.save();
};

messageSchema.methods.editContent = function(newContent) {
  // Store edit history
  this.editHistory.push({
    content: this.content.text,
    editedAt: new Date()
  });
  
  // Update content
  this.content.text = newContent;
  this.isEdited = true;
  return this.save();
};

messageSchema.methods.softDelete = function() {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.content.text = 'This message was deleted';
  this.attachments = [];
  return this.save();
};

// Static methods
messageSchema.statics.findByChatId = function(chatId, limit = 50, before = null) {
  const query = { chatId, isDeleted: false };
  if (before) {
    query.createdAt = { $lt: new Date(before) };
  }
  
  return this.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
};

messageSchema.statics.findUnreadForUser = function(userId, chatIds) {
  return this.find({
    chatId: { $in: chatIds },
    'sender.userId': { $ne: userId },
    'readBy.userId': { $ne: userId },
    isDeleted: false
  });
};

messageSchema.statics.markChatAsRead = function(chatId, userId) {
  return this.updateMany(
    {
      chatId,
      'sender.userId': { $ne: userId },
      'readBy.userId': { $ne: userId },
      isDeleted: false
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
};

messageSchema.statics.searchMessages = function(chatId, query, limit = 20) {
  return this.find({
    chatId,
    'content.text': { $regex: query, $options: 'i' },
    isDeleted: false
  })
  .sort({ createdAt: -1 })
  .limit(limit)
  .lean();
};

module.exports = mongoose.model('Message', messageSchema);
