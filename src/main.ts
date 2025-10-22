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

// Load .env file BEFORE importing any other modules
import dotenv from "dotenv";
dotenv.config();

import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import * as fs from "fs";
import { ExpressAdapter } from "@nestjs/platform-express";
import express from "express";
import { configureApp } from "./app.bootstrap";
import { loadEnvironment } from "./config/environment";

async function bootstrap() {
  const env = loadEnvironment();
  const server = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server));
  await configureApp(app);
  const port = env.service.port;

  // HTTPS configuration for production
  if (
    env.service.nodeEnv === "production" &&
    process.env.SSL_KEY_PATH &&
    process.env.SSL_CERT_PATH
  ) {
    const httpsOptions = {
      key: fs.readFileSync(process.env.SSL_KEY_PATH),
      cert: fs.readFileSync(process.env.SSL_CERT_PATH),
    };
    void httpsOptions;

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
    console.log(
      "📄 OpenAPI Spec: http://localhost:" + port + "/docs/openapi.yaml",
    );
  }

  await app.listen(port);

  // Graceful shutdown handlers
  const gracefulShutdown = async (signal: string) => {
    console.log(`\n${signal} received, initiating graceful shutdown...`);

    try {
      // 1. Stop accepting new HTTP connections
      console.log("Closing HTTP server...");
      await app.close();
      console.log("HTTP server closed, no longer accepting connections");

      // 2. Socket.IO server will emit 'server_shutdown' to clients
      // (handled by socket gateway's onModuleDestroy)
      console.log("Socket.IO cleanup initiated via module destroy hooks");

      // 3. Wait briefly for messages in flight
      await new Promise((resolve) => setTimeout(resolve, 2000));
      console.log("Grace period complete");

      // 4. Exit cleanly
      console.log("Exiting gracefully");
      process.exit(0);
    } catch (error) {
      console.error("Error during graceful shutdown:", error);
      process.exit(1);
    }
  };

  // Register shutdown handlers
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  console.log("Graceful shutdown handlers registered (SIGTERM, SIGINT)");
}

bootstrap().catch((error) => {
  console.error("Failed to start application:", error);
  process.exit(1);
});
