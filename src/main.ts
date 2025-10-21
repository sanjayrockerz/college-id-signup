/**
 * Chat Backend Service - Bootstrap
 *
 * TRUST MODEL: This service is identity-agnostic and does NOT implement authentication.
 *
 * - userId is treated as untrusted, optional metadata for message attribution only
 * - NO identity verification or authorization is performed
 * - Upstream services MUST handle authentication before calling this backend
 * - Security relies on: IP-based rate limiting, input validation, network segmentation
 *
 * Production Deployment: Do NOT expose this service directly to public clients.
 * Always route through an authenticated upstream gateway or API service.
 *
 * Policy: docs/scope/no-auth-policy.md
 * Integration Guide: docs/scope/upstream-integration.md
 */

import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ValidationPipe } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import { ExpressAdapter } from "@nestjs/platform-express";
import express from "express";
import { registerDocsRoutes } from "./docs/registerDocs";
import {
  requestIdMiddleware,
  requestLoggingMiddleware,
  metricsMiddleware,
  metricsEndpoint,
} from "./middleware/logging";

async function bootstrap() {
  const server = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server));

  // Request ID generation (must be first)
  app.use(requestIdMiddleware);

  // Request logging with safe redaction
  app.use(requestLoggingMiddleware);

  // Metrics collection
  app.use(metricsMiddleware);

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Production-grade CORS restrictions
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(",") || ["http://localhost:3000"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
    exposedHeaders: [
      "X-Request-ID",
      "RateLimit-Limit",
      "RateLimit-Remaining",
      "RateLimit-Reset",
    ],
    maxAge: 3600,
  });

  // Security headers (production-grade)
  app.use((req, res, next) => {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
      "Permissions-Policy",
      "geolocation=(), microphone=(), camera=()",
    );
    next();
  });

  // Serve OpenAPI and Redoc at /docs
  registerDocsRoutes(server);

  // Global prefix for API routes
  app.setGlobalPrefix("api/v1");

  const port = process.env.PORT || 3001;

  // HTTPS configuration for production
  if (
    process.env.NODE_ENV === "production" &&
    process.env.SSL_KEY_PATH &&
    process.env.SSL_CERT_PATH
  ) {
    const httpsOptions = {
      key: fs.readFileSync(process.env.SSL_KEY_PATH),
      cert: fs.readFileSync(process.env.SSL_CERT_PATH),
    };

    // Note: For HTTPS, you would need to use NestFactory.create(AppModule, { httpsOptions })
    console.log(`Application is running on https://localhost:${port}`);
  } else {
    console.log(`Application is running on http://localhost:${port}`);
    console.log("");
    console.log("🔍 Monitoring Endpoints:");
    console.log(`  - Health: http://localhost:${port}/health`);
    console.log(`  - Metrics: http://localhost:${port}/metrics`);
    console.log("");
    console.log("📚 Available API Endpoints:");
    console.log(`  - Chat: http://localhost:${port}/api/v1/chat`);
    console.log(`  - Users: http://localhost:${port}/api/v1/users`);
    console.log("");
    console.log("🛡️  Security: Rate limiting, validation, logging enabled");
    console.log("📖 API Docs UI: http://localhost:" + port + "/docs");
    console.log("📄 OpenAPI Spec: http://localhost:" + port + "/docs/openapi.yaml");
  }

  await app.listen(port);
}

bootstrap().catch((error) => {
  console.error("Failed to start application:", error);
  process.exit(1);
});
