import rateLimit from "express-rate-limit";
import { Request, Response } from "express";
import { getEnv } from "../config/environment";

/**
 * Rate Limiting Configuration for Public API
 *
 * Since all endpoints are public without authentication, rate limiting
 * is critical to prevent abuse and ensure fair usage.
 *
 * Set DISABLE_RATE_LIMIT=true to disable rate limiting (for load testing only)
 */

function isRateLimitDisabled(): boolean {
  return getEnv().flags.disableRateLimit;
}

/**
 * General API rate limiter - applies to most endpoints
 * 100 requests per 15 minutes per IP
 */
export const apiLimiter = rateLimit({
  skip: () => isRateLimitDisabled(),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    error: "Too many requests from this IP, please try again later.",
    retryAfter: "15 minutes",
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      error: "Rate limit exceeded",
      message:
        "Too many requests from this IP address. Please try again later.",
      retryAfter: (req as any).rateLimit?.resetTime || "in 15 minutes",
    });
  },
});

/**
 * Strict rate limiter for write operations (POST, PUT, DELETE)
 * 30 requests per 15 minutes per IP
 */
export const writeOperationLimiter = rateLimit({
  skip: (req: Request) =>
    isRateLimitDisabled() || req.method === "GET" || req.method === "HEAD",
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // Limit each IP to 30 write requests per windowMs
  message: {
    success: false,
    error: "Too many write operations from this IP, please try again later.",
    retryAfter: "15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      error: "Write operation rate limit exceeded",
      message:
        "Too many write operations from this IP address. Please try again later.",
      retryAfter: (req as any).rateLimit?.resetTime || "in 15 minutes",
    });
  },
});

/**
 * Upload rate limiter - very strict for file uploads
 * 10 uploads per 15 minutes per IP
 */
export const uploadLimiter = rateLimit({
  skip: () => isRateLimitDisabled(),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 uploads per windowMs
  message: {
    success: false,
    error: "Too many file uploads from this IP, please try again later.",
    retryAfter: "15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      error: "Upload rate limit exceeded",
      message:
        "Too many file uploads from this IP address. Please try again later.",
      retryAfter: (req as any).rateLimit?.resetTime || "in 15 minutes",
    });
  },
});

/**
 * Message rate limiter - moderate limits for real-time messaging
 * 200 messages per 15 minutes per IP
 */
export const messagingLimiter = rateLimit({
  skip: () => isRateLimitDisabled(),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Limit each IP to 200 messages per windowMs
  message: {
    success: false,
    error: "Too many messages sent from this IP, please try again later.",
    retryAfter: "15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      error: "Messaging rate limit exceeded",
      message: "Too many messages sent from this IP address. Please slow down.",
      retryAfter: (req as any).rateLimit?.resetTime || "in 15 minutes",
    });
  },
});

/**
 * Admin operations rate limiter - strict for admin endpoints
 * 20 requests per 15 minutes per IP
 */
export const adminLimiter = rateLimit({
  skip: () => isRateLimitDisabled(),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 admin requests per windowMs
  message: {
    success: false,
    error: "Too many admin requests from this IP, please try again later.",
    retryAfter: "15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      error: "Admin rate limit exceeded",
      message:
        "Too many admin operations from this IP address. Please try again later.",
      retryAfter: (req as any).rateLimit?.resetTime || "in 15 minutes",
    });
  },
});
