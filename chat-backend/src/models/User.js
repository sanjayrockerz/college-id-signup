const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  // Basic user info
  userId: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  firstName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  lastName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  profileImage: {
    type: String,
    default: null
  },
  bio: {
    type: String,
    maxlength: 500,
    default: ''
  },
  
  // College info
  collegeName: {
    type: String,
    required: true,
    trim: true
  },
  collegeId: {
    type: String,
    required: true,
    trim: true
  },
  graduationYear: {
    type: Number,
    required: true
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  
  // Chat-specific settings
  isOnline: {
    type: Boolean,
    default: false
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },
  socketIds: [{
    type: String
  }],
  
  // Privacy settings
  chatPrivacy: {
    type: String,
    enum: ['everyone', 'connections', 'nobody'],
    default: 'connections'
  },
  readReceipts: {
    type: Boolean,
    default: true
  },
  onlineStatus: {
    type: Boolean,
    default: true
  },
  
  // Notification preferences
  notifications: {
    messages: {
      type: Boolean,
      default: true
    },
    mentions: {
      type: Boolean,
      default: true
    },
    groupInvites: {
      type: Boolean,
      default: true
    }
  },
  
  // Security
  blockedUsers: [{
    userId: String,
    blockedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Metadata
  deviceInfo: {
    type: String,
    default: null
  },
  ipAddress: {
    type: String,
    default: null
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      delete ret.socketIds;
      delete ret.ipAddress;
      delete ret.__v;
      return ret;
    }
  }
});

// Indexes for better performance
userSchema.index({ userId: 1 });
userSchema.index({ username: 1 });
userSchema.index({ email: 1 });
userSchema.index({ collegeId: 1 });
userSchema.index({ isOnline: 1 });
userSchema.index({ lastSeen: 1 });

// Instance methods
userSchema.methods.toPublicProfile = function() {
  return {
    userId: this.userId,
    username: this.username,
    firstName: this.firstName,
    lastName: this.lastName,
    profileImage: this.profileImage,
    bio: this.bio,
    collegeName: this.collegeName,
    graduationYear: this.graduationYear,
    isVerified: this.isVerified,
    isOnline: this.isOnline,
    lastSeen: this.lastSeen
  };
};

userSchema.methods.updateLastSeen = function() {
  this.lastSeen = new Date();
  return this.save();
};

userSchema.methods.addSocketId = function(socketId) {
  if (!this.socketIds.includes(socketId)) {
    this.socketIds.push(socketId);
  }
  this.isOnline = true;
  return this.save();
};

userSchema.methods.removeSocketId = function(socketId) {
  this.socketIds = this.socketIds.filter(id => id !== socketId);
  if (this.socketIds.length === 0) {
    this.isOnline = false;
  }
  return this.save();
};

userSchema.methods.isBlocked = function(userId) {
  return this.blockedUsers.some(blocked => blocked.userId === userId);
};

userSchema.methods.blockUser = function(userId) {
  if (!this.isBlocked(userId)) {
    this.blockedUsers.push({ userId });
  }
  return this.save();
};

userSchema.methods.unblockUser = function(userId) {
  this.blockedUsers = this.blockedUsers.filter(blocked => blocked.userId !== userId);
  return this.save();
};

// Static methods
userSchema.statics.findByUserId = function(userId) {
  return this.findOne({ userId });
};

userSchema.statics.findOnlineUsers = function() {
  return this.find({ isOnline: true });
};

userSchema.statics.findByCollege = function(collegeId) {
  return this.find({ collegeId, isVerified: true });
};

module.exports = mongoose.model('User', userSchema);
