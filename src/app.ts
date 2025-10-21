import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import multer from "multer";
import { getPrismaClient } from "./config/database";
import { apiLimiter } from "./middleware/rateLimiter";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
// Security headers
app.use(helmet());

// CORS
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  }),
);

// Apply general rate limiting to all requests
app.use(apiLimiter);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Serve static files (uploaded images)
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// Health check endpoint
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Database connection test
app.get("/health/database", async (_req: Request, res: Response) => {
  try {
    const prisma = getPrismaClient();
    // Simple query to test connection
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      status: "OK",
      database: "Connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("Database health check failed:", error);
    res.status(500).json({
      status: "ERROR",
      database: "Disconnected",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Root endpoint
app.get("/", (_req: Request, res: Response) => {
  res.json({
    message: "College ID Signup API - Public Access",
    version: "1.0.0",
    notice:
      "⚠️ This API operates without authentication. All endpoints are public.",
    endpoints: {
      idCard: "(removed)",
      health: {
        general: "GET /health",
        database: "GET /health/database",
      },
    },
  });
});

// 404 handler
app.use("*", (req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: "Not Found",
    message: `Route ${req.method} ${req.originalUrl} not found`,
    timestamp: new Date().toISOString(),
  });
});

// Global error handler
app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Global error handler:", error);

  // Multer file upload errors
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        error: "File too large",
        message: "File size must be less than 10MB",
      });
    }
  }

  // File filter errors
  if (error.message === "Only image files are allowed") {
    return res.status(400).json({
      success: false,
      error: "Invalid file type",
      message: "Only image files (JPG, PNG, GIF, etc.) are allowed",
    });
  }

  // Default error response
  return res.status(500).json({
    success: false,
    error: "Internal Server Error",
    message: "An unexpected error occurred",
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV === "development" && { details: error.message }),
  });
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received. Shutting down gracefully...");

  try {
    const prisma = getPrismaClient();
    await prisma.$disconnect();
    console.log("Database connections closed.");
  } catch (error) {
    console.error("Error during shutdown:", error);
  }

  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("SIGINT received. Shutting down gracefully...");

  try {
    const prisma = getPrismaClient();
    await prisma.$disconnect();
    console.log("Database connections closed.");
  } catch (error) {
    console.error("Error during shutdown:", error);
  }

  process.exit(0);
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`
🚀 College Social Platform API Server is running!

⚠️  WARNING: No authentication - All endpoints are public!

📍 URL: http://localhost:${PORT}
🏥 Health Check: http://localhost:${PORT}/health
🗄️  Database Health: http://localhost:${PORT}/health/database
📚 API Documentation: http://localhost:${PORT}/

📋 Available Endpoints:
┌─────────────────────────────────────────────────────────────┐
│ ID Card Verification Endpoints                             │
├─────────────────────────────────────────────────────────────┤
│ Feature removed. All previous endpoints now return 410.    │
└─────────────────────────────────────────────────────────────┘

🛡️  Security: Rate limiting enabled (100 req/15min general, 10 req/15min uploads)
🔧 Environment: ${process.env.NODE_ENV || "development"}
🕒 Started at: ${new Date().toISOString()}
  `);
});

export { app, server };
