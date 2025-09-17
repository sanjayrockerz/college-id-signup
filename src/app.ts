import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import multer from 'multer';
import { getPrismaClient } from './config/database';

// Import routes
import authRoutes from './routes/auth';
import idcardRoutes from './routes/idcard';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files (uploaded images)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Database connection test
app.get('/health/database', async (req: Request, res: Response) => {
  try {
    const prisma = getPrismaClient();
    // Simple query to test connection
    await prisma.$queryRaw`SELECT 1`;
    
    res.json({
      status: 'OK',
      database: 'Connected',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Database health check failed:', error);
    res.status(500).json({
      status: 'ERROR',
      database: 'Disconnected',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/id-card', idcardRoutes);

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.json({
    message: 'College ID Signup API',
    version: '1.0.0',
    endpoints: {
      auth: {
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login',
        profile: 'GET /api/auth/me',
        updateProfile: 'PUT /api/auth/profile',
        changePassword: 'PUT /api/auth/password',
        logout: 'POST /api/auth/logout'
      },
      idCard: {
        upload: 'POST /api/id-card/upload',
        status: 'GET /api/id-card/status',
        resubmit: 'PUT /api/id-card/resubmit',
        adminPending: 'GET /api/id-card/admin/pending',
        adminReview: 'PUT /api/id-card/admin/review/:verificationId'
      },
      health: {
        general: 'GET /health',
        database: 'GET /health/database'
      }
    }
  });
});

// 404 handler
app.use('*', (req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Not Found',
    message: `Route ${req.method} ${req.originalUrl} not found`,
    timestamp: new Date().toISOString()
  });
});

// Global error handler
app.use((error: any, req: Request, res: Response, next: NextFunction) => {
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

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  
  try {
    const prisma = getPrismaClient();
    await prisma.$disconnect();
    console.log('Database connections closed.');
  } catch (error) {
    console.error('Error during shutdown:', error);
  }
  
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received. Shutting down gracefully...');
  
  try {
    const prisma = getPrismaClient();
    await prisma.$disconnect();
    console.log('Database connections closed.');
  } catch (error) {
    console.error('Error during shutdown:', error);
  }
  
  process.exit(0);
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`
🚀 College ID Signup API Server is running!

📍 URL: http://localhost:${PORT}
🏥 Health Check: http://localhost:${PORT}/health
🗄️  Database Health: http://localhost:${PORT}/health/database
📚 API Documentation: http://localhost:${PORT}/

📋 Available Endpoints:
┌─────────────────────────────────────────────────────────────┐
│ Authentication Endpoints                                    │
├─────────────────────────────────────────────────────────────┤
│ POST   /api/auth/register    - Register new user           │
│ POST   /api/auth/login       - User login                  │
│ GET    /api/auth/me          - Get current user profile    │
│ PUT    /api/auth/profile     - Update user profile         │
│ PUT    /api/auth/password    - Change password             │
│ POST   /api/auth/logout      - User logout                 │
├─────────────────────────────────────────────────────────────┤
│ ID Card Verification Endpoints                             │
├─────────────────────────────────────────────────────────────┤
│ POST   /api/id-card/upload   - Upload ID card for verify   │
│ GET    /api/id-card/status   - Get verification status     │
│ PUT    /api/id-card/resubmit - Resubmit after rejection    │
│ GET    /api/id-card/admin/pending - Get pending reviews    │
│ PUT    /api/id-card/admin/review/:id - Approve/reject      │
└─────────────────────────────────────────────────────────────┘

🔧 Environment: ${process.env.NODE_ENV || 'development'}
🕒 Started at: ${new Date().toISOString()}
  `);
});

export { app, server };
