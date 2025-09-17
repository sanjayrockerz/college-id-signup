const { verifyToken } = require('../utils/jwt');
const { getPrismaClient } = require('../config/database');

/**
 * Express middleware to authenticate JWT tokens
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function authenticateToken(req, res, next) {
  try {
    // Get token from Authorization header (Bearer token)
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Access token required',
        message: 'Please provide a valid authorization token'
      });
    }

    // Verify the token
    const decoded = verifyToken(token);
    
    if (!decoded || !decoded.sub) {
      return res.status(403).json({
        success: false,
        error: 'Invalid token',
        message: 'Token does not contain valid user information'
      });
    }

    // Get Prisma client instance
    const prisma = getPrismaClient();

    // Find user by id from token payload
    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        bio: true,
        profileImageUrl: true,
        isVerified: true,
        verifiedCollegeId: true,
        collegeName: true,
        studentIdNumber: true,
        graduationYear: true,
        allowDirectMessages: true,
        showOnlineStatus: true,
        profileVisibility: true,
        createdAt: true,
        updatedAt: true,
        lastLoginAt: true,
        // Explicitly exclude password field
      }
    });

    if (!user) {
      return res.status(403).json({
        success: false,
        error: 'User not found',
        message: 'The user associated with this token no longer exists'
      });
    }

    // Attach user to request object (without password)
    req.user = user;
    
    // Also attach the full decoded token payload for additional info
    req.tokenPayload = decoded;

    next();
  } catch (error) {
    // Handle different types of token errors
    let errorMessage = 'Invalid or expired token';
    let statusCode = 403;

    if (error.message.includes('expired')) {
      errorMessage = 'Token has expired';
      statusCode = 401;
    } else if (error.message.includes('invalid')) {
      errorMessage = 'Invalid token format';
    } else if (error.message.includes('signature')) {
      errorMessage = 'Token signature is invalid';
    }

    return res.status(statusCode).json({
      success: false,
      error: 'Authentication failed',
      message: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

module.exports = {
  authenticateToken,
};
