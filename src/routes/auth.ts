import { Router, Request, Response } from 'express';
import { generateToken } from '../utils/jwt';
import { hashPassword, comparePassword } from '../utils/password';
import { getPrismaClient } from '../config/database';
import { authenticateToken } from '../middleware/auth';

const router = Router();

interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    email: string;
    isVerified: boolean;
  };
}

interface RegisterBody {
  email: string;
  password: string;
  username: string;
  firstName?: string;
  lastName?: string;
  collegeName?: string;
  studentIdNumber?: string;
}

interface LoginBody {
  email: string;
  password: string;
}

interface UpdateProfileBody {
  firstName?: string;
  lastName?: string;
  bio?: string;
  profileImageUrl?: string;
  graduationYear?: number;
  allowDirectMessages?: boolean;
  showOnlineStatus?: boolean;
  profileVisibility?: 'PUBLIC' | 'CONNECTIONS_ONLY' | 'CLOSE_FRIENDS_ONLY' | 'PRIVATE';
}

interface ChangePasswordBody {
  currentPassword: string;
  newPassword: string;
}

/**
 * User Registration
 * POST /api/auth/register
 */
router.post('/register', async (req: Request<{}, {}, RegisterBody>, res: Response) => {
  try {
    const { email, password, username, firstName, lastName, collegeName, studentIdNumber } = req.body;

    // Validate required fields
    if (!email || !password || !username) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'Email, password, and username are required'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format',
        message: 'Please provide a valid email address'
      });
    }

    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Weak password',
        message: 'Password must be at least 8 characters long'
      });
    }

    const prisma = getPrismaClient();

    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email: email.toLowerCase() },
          { username: username.toLowerCase() }
        ]
      }
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: 'User already exists',
        message: existingUser.email === email.toLowerCase() 
          ? 'An account with this email already exists'
          : 'This username is already taken'
      });
    }

    // Hash the password
    const hashedPassword = await hashPassword(password);

    // Create the user
    const newUser = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        username: username.toLowerCase(),
        password: hashedPassword,
        firstName: firstName || null,
        lastName: lastName || null,
        collegeName: collegeName || null,
        studentIdNumber: studentIdNumber || null,
        isVerified: false,
        anonymousPostsToday: 0,
        weeklyPushesUsed: 0,
        lastWeeklyReset: new Date(),
        allowDirectMessages: true,
        showOnlineStatus: true,
        profileVisibility: 'PUBLIC'
      }
    });

    // Generate JWT token
    const token = generateToken({
      sub: newUser.id,
      username: newUser.username,
      email: newUser.email,
      isVerified: newUser.isVerified
    });

    // Return user data (without password)
    const { password: _, ...userWithoutPassword } = newUser;

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: userWithoutPassword,
        token
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Registration failed',
      message: 'An error occurred during registration'
    });
  }
});

/**
 * User Login
 * POST /api/auth/login
 */
router.post('/login', async (req: Request<{}, {}, LoginBody>, res: Response) => {
  try {
    const { email, password } = req.body;

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Missing credentials',
        message: 'Email and password are required'
      });
    }

    const prisma = getPrismaClient();

    // Find user by email or username
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: email.toLowerCase() },
          { username: email.toLowerCase() } // Allow login with username too
        ]
      }
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        message: 'Email or password is incorrect'
      });
    }

    // Verify password
    const isValidPassword = await comparePassword(password, user.password);

    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        message: 'Email or password is incorrect'
      });
    }

    // Update last login time
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });

    // Generate JWT token
    const token = generateToken({
      sub: user.id,
      username: user.username,
      email: user.email,
      isVerified: user.isVerified
    });

    // Return user data (without password)
    const { password: _, ...userWithoutPassword } = user;

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: userWithoutPassword,
        token
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed',
      message: 'An error occurred during login'
    });
  }
});

/**
 * Get Current User Profile
 * GET /api/auth/me
 */
router.get('/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'User ID not found in token'
      });
    }

    const prisma = getPrismaClient();

    const user = await prisma.user.findUnique({
      where: { id: userId },
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
        anonymousPostsToday: true,
        weeklyPushesUsed: true,
        allowDirectMessages: true,
        showOnlineStatus: true,
        profileVisibility: true,
        createdAt: true,
        lastLoginAt: true
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        message: 'User account no longer exists'
      });
    }

    res.json({
      success: true,
      data: { user }
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get profile',
      message: 'An error occurred while fetching user profile'
    });
  }
});

/**
 * Update User Profile
 * PUT /api/auth/profile
 */
router.put('/profile', authenticateToken, async (req: AuthRequest & { body: UpdateProfileBody }, res: Response) => {
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'User ID not found in token'
      });
    }

    const {
      firstName,
      lastName,
      bio,
      profileImageUrl,
      graduationYear,
      allowDirectMessages,
      showOnlineStatus,
      profileVisibility
    } = req.body;

    // Validate profile visibility
    const validVisibility = ['PUBLIC', 'CONNECTIONS_ONLY', 'CLOSE_FRIENDS_ONLY', 'PRIVATE'];
    if (profileVisibility && !validVisibility.includes(profileVisibility)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid profile visibility',
        message: 'Profile visibility must be one of: ' + validVisibility.join(', ')
      });
    }

    const prisma = getPrismaClient();

    // Update user profile
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        firstName: firstName !== undefined ? firstName : undefined,
        lastName: lastName !== undefined ? lastName : undefined,
        bio: bio !== undefined ? bio : undefined,
        profileImageUrl: profileImageUrl !== undefined ? profileImageUrl : undefined,
        graduationYear: graduationYear !== undefined ? graduationYear : undefined,
        allowDirectMessages: allowDirectMessages !== undefined ? allowDirectMessages : undefined,
        showOnlineStatus: showOnlineStatus !== undefined ? showOnlineStatus : undefined,
        profileVisibility: profileVisibility !== undefined ? profileVisibility : undefined,
        updatedAt: new Date()
      },
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
        updatedAt: true
      }
    });

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { user: updatedUser }
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update profile',
      message: 'An error occurred while updating profile'
    });
  }
});

/**
 * Change Password
 * PUT /api/auth/password
 */
router.put('/password', authenticateToken, async (req: AuthRequest & { body: ChangePasswordBody }, res: Response) => {
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'User ID not found in token'
      });
    }

    const { currentPassword, newPassword } = req.body;

    // Validate required fields
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'Current password and new password are required'
      });
    }

    // Validate new password strength
    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Weak password',
        message: 'New password must be at least 8 characters long'
      });
    }

    const prisma = getPrismaClient();

    // Get current user
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        message: 'User account no longer exists'
      });
    }

    // Verify current password
    const isCurrentPasswordValid = await comparePassword(currentPassword, user.password);

    if (!isCurrentPasswordValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid current password',
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const hashedNewPassword = await hashPassword(newPassword);

    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: {
        password: hashedNewPassword,
        updatedAt: new Date()
      }
    });

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to change password',
      message: 'An error occurred while changing password'
    });
  }
});

/**
 * Logout (Token invalidation would be handled client-side)
 * POST /api/auth/logout
 */
router.post('/logout', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    // In a stateless JWT system, logout is typically handled client-side
    // by removing the token from storage
    // Here we could add token to a blacklist if needed

    res.json({
      success: true,
      message: 'Logout successful',
      instructions: 'Please remove the token from client storage'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      error: 'Logout failed',
      message: 'An error occurred during logout'
    });
  }
});

export default router;
