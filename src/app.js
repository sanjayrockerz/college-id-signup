const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const multer = require('multer');
const { getPrismaClient } = require('./config/database');
const { 
  apiLimiter, 
  messagingLimiter, 
  uploadLimiter, 
  adminLimiter 
} = require('./middleware/rateLimiter');

// Import routes
const chatRoutes = require('./routes/chat');
const conversationsRoutes = require('./routes/conversations');
const uploadRoutes = require('./routes/upload');

const app = express();

// Middleware
// Security headers
app.use(helmet());

// CORS
app.use(cors({
  origin: process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// Apply general rate limiting to all requests
app.use(apiLimiter);

// JSON body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files (uploaded images)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Database connection test
app.get('/health/database', async (req, res) => {
  try {
    const prisma = getPrismaClient();
    // Simple query to test connection
    await prisma.$queryRaw`SELECT 1`;
    
    res.json({
      status: 'OK',
      database: 'Connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Database health check failed:', error);
    res.status(500).json({
      status: 'ERROR',
      database: 'Disconnected',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// API Routes with specific rate limiters
// ID card route removed; legacy endpoints respond with 410 via stub router.
app.use('/api/chat', messagingLimiter, chatRoutes);
app.use('/api/conversations', messagingLimiter, conversationsRoutes);
app.use('/api/upload', uploadLimiter, uploadRoutes);

// Error handling middleware (should be after routes)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal Server Error'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'College ID Signup API - Public Access',
    version: '1.0.0',
    notice: '⚠️ This API operates without authentication. All endpoints are public.',
    endpoints: {
      chat: {
        conversations: 'GET /api/chat/conversations',
        createConversation: 'POST /api/chat/conversations',
        getMessages: 'GET /api/chat/conversations/:id/messages',
        sendMessage: 'POST /api/chat/conversations/:id/messages',
        searchUsers: 'GET /api/chat/users/search'
      },
      conversations: {
        getAllConversations: 'GET /api/conversations',
        getMessages: 'GET /api/conversations/:id/messages',
        createConversation: 'POST /api/conversations'
      },
      upload: {
        signUrl: 'POST /api/upload/sign-url',
        config: 'GET /api/upload/config'
      },
      idCard: 'Feature removed. All previous endpoints now return 410.',
      health: {
        general: 'GET /health',
        database: 'GET /health/database'
      },
      realtime: {
        socketio: 'ws://localhost:3001',
        events: {
          join_conversation: 'Join a conversation room',
          leave_conversation: 'Leave a conversation room',
          send_message: 'Send a message to conversation',
          typing_start: 'Start typing indicator',
          typing_stop: 'Stop typing indicator',
          mark_message_read: 'Mark message as read'
        }
      }
    }
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not Found',
    message: `Route ${req.method} ${req.originalUrl} not found`,
    timestamp: new Date().toISOString()
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Global error handler:', error);

  // Multer file upload errors
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File too large',
        message: 'File size must be less than 10MB'
      });
    }
  }

  // File filter errors
  if (error.message === 'Only image files are allowed') {
    return res.status(400).json({
      success: false,
      error: 'Invalid file type',
      message: 'Only image files (JPG, PNG, GIF, etc.) are allowed'
    });
  }

  // Default error response
  res.status(500).json({
    success: false,
    error: 'Internal Server Error',
    message: 'An unexpected error occurred',
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV === 'development' && { details: error.message })
  });
});

module.exports = { app };
