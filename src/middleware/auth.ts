import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';
import { getPrismaClient } from '../config/database';

// Extend Request interface to include user property
interface AuthRequest extends Request {
  user?: any;
  userId?: string;
  tokenPayload?: any;
  headers: Request['headers'];
}

/**
 * Express middleware for JWT authentication
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export async function authenticateToken(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      res.status(401).json({
        success: false,
        error: 'NO_TOKEN',
        message: 'Access token is required'
      });
      return;
    }

    // Use verifyToken to get userId
    const decoded = verifyToken(token);
    
    if (!decoded || !decoded.sub) {
      res.status(403).json({
        success: false,
        error: 'INVALID_TOKEN',
        message: 'Token does not contain valid user information'
      });
      return;
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
      res.status(403).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'The user associated with this token no longer exists'
      });
      return;
    }

    // Attach user information to request object
    req.user = user;
    req.userId = userId;
    req.tokenPayload = decoded;

    next();
  } catch (error: any) {
    // Handle different types of authentication errors
    let statusCode = 403;
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
      statusCode = 500;
      errorType = 'DATABASE_ERROR';
      errorMessage = 'Database connection error';
    }

    res.status(statusCode).json({
      success: false,
      error: errorType,
      message: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * Helper function to get authenticated user from request
 * @param req - Express request object
 * @returns User object or null if not authenticated
 */
export function getRequestUser(req: AuthRequest): any {
  return req.user || null;
}

/**
 * Helper function to get user ID from request
 * @param req - Express request object
 * @returns User ID or null if not authenticated
 */
export function getRequestUserId(req: AuthRequest): string | null {
  return req.userId || null;
}

/**
 * Helper function to check if request is authenticated
 * @param req - Express request object
 * @returns True if authenticated, false otherwise
 */
export function isRequestAuthenticated(req: AuthRequest): boolean {
  return !!(req.userId && req.user);
}
