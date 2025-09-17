const { verifyToken } = require('../utils/jwt');
const { getPrismaClient } = require('../config/database');

/**
 * Socket.IO middleware for authentication
 * @param {Object} socket - Socket.IO socket instance
 * @param {Function} next - Socket.IO next function
 */
async function socketAuthMiddleware(socket, next) {
  try {
    // Get token from handshake auth
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];

    if (!token) {
      const error = new Error('Authentication token required');
      error.data = {
        success: false,
        error: 'NO_TOKEN',
        message: 'Please provide a valid authentication token'
      };
      return next(error);
    }

    // Use verifyToken to get userId
    const decoded = verifyToken(token);
    
    if (!decoded || !decoded.sub) {
      const error = new Error('Invalid token payload');
      error.data = {
        success: false,
        error: 'INVALID_TOKEN',
        message: 'Token does not contain valid user information'
      };
      return next(error);
    }

    const userId = decoded.sub;

    // Get Prisma client instance
    const prisma = getPrismaClient();

    // Use Prisma to find user by userId
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        profileImageUrl: true,
        isVerified: true,
        allowDirectMessages: true,
        showOnlineStatus: true,
        profileVisibility: true,
        // Don't include password or sensitive data
      }
    });

    if (!user) {
      const error = new Error('User not found');
      error.data = {
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'The user associated with this token no longer exists'
      };
      return next(error);
    }

    // Attach userId and user data to socket
    socket.userId = userId;
    socket.user = user;
    socket.tokenPayload = decoded;

    // Log successful authentication (in development)
    if (process.env.NODE_ENV === 'development') {
      console.log(`Socket authenticated: ${user.username} (${userId})`);
    }

    next();
  } catch (error) {
    // Handle different types of authentication errors
    let errorType = 'AUTH_ERROR';
    let errorMessage = 'Authentication failed';

    if (error.message.includes('expired')) {
      errorType = 'TOKEN_EXPIRED';
      errorMessage = 'Token has expired';
    } else if (error.message.includes('invalid')) {
      errorType = 'INVALID_TOKEN';
      errorMessage = 'Invalid token format';
    } else if (error.message.includes('signature')) {
      errorType = 'INVALID_SIGNATURE';
      errorMessage = 'Token signature is invalid';
    } else if (error.message.includes('Database')) {
      errorType = 'DATABASE_ERROR';
      errorMessage = 'Database connection error';
    }

    const authError = new Error(errorMessage);
    authError.data = {
      success: false,
      error: errorType,
      message: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    };

    next(authError);
  }
}

/**
 * Helper function to get authenticated user from socket
 * @param {Object} socket - Socket.IO socket instance
 * @returns {Object|null} User object or null if not authenticated
 */
function getSocketUser(socket) {
  return socket.user || null;
}

/**
 * Helper function to get user ID from socket
 * @param {Object} socket - Socket.IO socket instance
 * @returns {string|null} User ID or null if not authenticated
 */
function getSocketUserId(socket) {
  return socket.userId || null;
}

/**
 * Helper function to check if socket is authenticated
 * @param {Object} socket - Socket.IO socket instance
 * @returns {boolean} True if authenticated, false otherwise
 */
function isSocketAuthenticated(socket) {
  return !!(socket.userId && socket.user);
}

module.exports = {
  socketAuthMiddleware,
  getSocketUser,
  getSocketUserId,
  isSocketAuthenticated,
};
