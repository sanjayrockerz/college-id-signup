const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getPrismaClient } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/id-cards');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const filename = `idcard-${req.user.id}-${timestamp}${ext}`;
    cb(null, filename);
  }
});

const fileFilter = (req, file, cb) => {
  // Accept only image files
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

/**
 * Upload ID Card for Verification
 * POST /api/id-card/upload
 */
router.post('/upload', authenticateToken, upload.single('idCard'), async (req, res) => {
  try {
    const userId = req.user.id;
    const { collegeName, studentIdNumber, graduationYear } = req.body;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded',
        message: 'Please upload an ID card image'
      });
    }

    if (!collegeName || !studentIdNumber) {
      // Clean up uploaded file if validation fails
      fs.unlinkSync(req.file.path);
      
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'College name and student ID number are required'
      });
    }

    const prisma = getPrismaClient();

    // Check if user already has a pending or approved verification
    const existingVerification = await prisma.idCardVerification.findFirst({
      where: {
        userId: userId,
        status: {
          in: ['PENDING', 'APPROVED']
        }
      }
    });

    if (existingVerification) {
      // Clean up uploaded file
      fs.unlinkSync(req.file.path);
      
      return res.status(409).json({
        success: false,
        error: 'Verification already exists',
        message: existingVerification.status === 'PENDING' 
          ? 'You already have a pending verification request'
          : 'Your ID card is already verified'
      });
    }

    // Create verification record
    const verification = await prisma.idCardVerification.create({
      data: {
        userId: userId,
        imageUrl: `/uploads/id-cards/${req.file.filename}`,
        collegeName: collegeName,
        studentIdNumber: studentIdNumber,
        graduationYear: graduationYear ? parseInt(graduationYear) : null,
        status: 'PENDING',
        submittedAt: new Date()
      }
    });

    // Update user with college info
    await prisma.user.update({
      where: { id: userId },
      data: {
        collegeName: collegeName,
        studentIdNumber: studentIdNumber,
        graduationYear: graduationYear ? parseInt(graduationYear) : null
      }
    });

    res.status(201).json({
      success: true,
      message: 'ID card uploaded successfully for verification',
      data: {
        verification: {
          id: verification.id,
          status: verification.status,
          collegeName: verification.collegeName,
          studentIdNumber: verification.studentIdNumber,
          graduationYear: verification.graduationYear,
          submittedAt: verification.submittedAt
        }
      }
    });

  } catch (error) {
    // Clean up uploaded file if there's an error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    console.error('ID card upload error:', error);
    res.status(500).json({
      success: false,
      error: 'Upload failed',
      message: 'An error occurred while uploading ID card'
    });
  }
});

/**
 * Get ID Card Verification Status
 * GET /api/id-card/status
 */
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const prisma = getPrismaClient();

    const verification = await prisma.idCardVerification.findFirst({
      where: { userId: userId },
      orderBy: { submittedAt: 'desc' },
      select: {
        id: true,
        status: true,
        collegeName: true,
        studentIdNumber: true,
        graduationYear: true,
        submittedAt: true,
        reviewedAt: true,
        reviewedBy: true,
        rejectionReason: true
      }
    });

    if (!verification) {
      return res.json({
        success: true,
        data: {
          hasVerification: false,
          message: 'No ID card verification found'
        }
      });
    }

    res.json({
      success: true,
      data: {
        hasVerification: true,
        verification: verification
      }
    });

  } catch (error) {
    console.error('Get verification status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get status',
      message: 'An error occurred while fetching verification status'
    });
  }
});

/**
 * Resubmit ID Card (after rejection)
 * PUT /api/id-card/resubmit
 */
router.put('/resubmit', authenticateToken, upload.single('idCard'), async (req, res) => {
  try {
    const userId = req.user.id;
    const { collegeName, studentIdNumber, graduationYear } = req.body;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded',
        message: 'Please upload an ID card image'
      });
    }

    if (!collegeName || !studentIdNumber) {
      // Clean up uploaded file if validation fails
      fs.unlinkSync(req.file.path);
      
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'College name and student ID number are required'
      });
    }

    const prisma = getPrismaClient();

    // Check if user has a rejected verification
    const existingVerification = await prisma.idCardVerification.findFirst({
      where: {
        userId: userId,
        status: 'REJECTED'
      },
      orderBy: { submittedAt: 'desc' }
    });

    if (!existingVerification) {
      // Clean up uploaded file
      fs.unlinkSync(req.file.path);
      
      return res.status(404).json({
        success: false,
        error: 'No rejected verification found',
        message: 'You can only resubmit after a rejection'
      });
    }

    // Create new verification record
    const verification = await prisma.idCardVerification.create({
      data: {
        userId: userId,
        imageUrl: `/uploads/id-cards/${req.file.filename}`,
        collegeName: collegeName,
        studentIdNumber: studentIdNumber,
        graduationYear: graduationYear ? parseInt(graduationYear) : null,
        status: 'PENDING',
        submittedAt: new Date()
      }
    });

    // Update user with college info
    await prisma.user.update({
      where: { id: userId },
      data: {
        collegeName: collegeName,
        studentIdNumber: studentIdNumber,
        graduationYear: graduationYear ? parseInt(graduationYear) : null
      }
    });

    res.json({
      success: true,
      message: 'ID card resubmitted successfully for verification',
      data: {
        verification: {
          id: verification.id,
          status: verification.status,
          collegeName: verification.collegeName,
          studentIdNumber: verification.studentIdNumber,
          graduationYear: verification.graduationYear,
          submittedAt: verification.submittedAt
        }
      }
    });

  } catch (error) {
    // Clean up uploaded file if there's an error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    console.error('ID card resubmit error:', error);
    res.status(500).json({
      success: false,
      error: 'Resubmit failed',
      message: 'An error occurred while resubmitting ID card'
    });
  }
});

/**
 * Admin: Get All Pending Verifications
 * GET /api/id-card/admin/pending
 */
router.get('/admin/pending', authenticateToken, async (req, res) => {
  try {
    // Note: In a real app, you'd check if user has admin role
    // For now, we'll include this endpoint for admin functionality
    
    const prisma = getPrismaClient();

    const pendingVerifications = await prisma.idCardVerification.findMany({
      where: { status: 'PENDING' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            firstName: true,
            lastName: true,
            createdAt: true
          }
        }
      },
      orderBy: { submittedAt: 'asc' }
    });

    res.json({
      success: true,
      data: {
        verifications: pendingVerifications,
        count: pendingVerifications.length
      }
    });

  } catch (error) {
    console.error('Get pending verifications error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get pending verifications',
      message: 'An error occurred while fetching pending verifications'
    });
  }
});

/**
 * Admin: Approve/Reject Verification
 * PUT /api/id-card/admin/review/:verificationId
 */
router.put('/admin/review/:verificationId', authenticateToken, async (req, res) => {
  try {
    const { verificationId } = req.params;
    const { action, rejectionReason } = req.body; // action: 'approve' or 'reject'
    const reviewerId = req.user.id;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid action',
        message: 'Action must be either "approve" or "reject"'
      });
    }

    if (action === 'reject' && !rejectionReason) {
      return res.status(400).json({
        success: false,
        error: 'Missing rejection reason',
        message: 'Rejection reason is required when rejecting verification'
      });
    }

    const prisma = getPrismaClient();

    // Get the verification
    const verification = await prisma.idCardVerification.findUnique({
      where: { id: verificationId },
      include: { user: true }
    });

    if (!verification) {
      return res.status(404).json({
        success: false,
        error: 'Verification not found',
        message: 'The specified verification does not exist'
      });
    }

    if (verification.status !== 'PENDING') {
      return res.status(400).json({
        success: false,
        error: 'Verification already reviewed',
        message: `This verification has already been ${verification.status.toLowerCase()}`
      });
    }

    // Update verification status
    const updatedVerification = await prisma.idCardVerification.update({
      where: { id: verificationId },
      data: {
        status: action === 'approve' ? 'APPROVED' : 'REJECTED',
        reviewedAt: new Date(),
        reviewedBy: reviewerId,
        rejectionReason: action === 'reject' ? rejectionReason : null
      }
    });

    // If approved, update user verification status
    if (action === 'approve') {
      await prisma.user.update({
        where: { id: verification.userId },
        data: {
          isVerified: true,
          verifiedCollegeId: verification.collegeName // You might want a proper college ID system
        }
      });
    }

    res.json({
      success: true,
      message: `Verification ${action}d successfully`,
      data: {
        verification: {
          id: updatedVerification.id,
          status: updatedVerification.status,
          reviewedAt: updatedVerification.reviewedAt,
          rejectionReason: updatedVerification.rejectionReason
        }
      }
    });

  } catch (error) {
    console.error('Review verification error:', error);
    res.status(500).json({
      success: false,
      error: 'Review failed',
      message: 'An error occurred while reviewing verification'
    });
  }
});

module.exports = router;
