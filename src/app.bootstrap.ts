import { INestApplication, ValidationPipe } from "@nestjs/common";
import { registerDocsRoutes } from "./docs/registerDocs";
import {
  metricsMiddleware,
  requestIdMiddleware,
  requestLoggingMiddleware,
} from "./middleware/logging";
import { apiLimiter } from "./middleware/rateLimiter";
import { getEnv } from "./config/environment";
import { prometheusMetricsHandler } from "./observability/prometheus-endpoint";
import { TelemetryMetrics } from "./observability/metrics-registry";

const DEFAULT_CORS_ORIGINS = ["http://localhost:3000"] as const;
const DOCS_ROUTE_FLAG = Symbol.for("__docs_routes_registered__");
const METRICS_ROUTE_FLAG = Symbol.for("__metrics_route_registered__");

/**
 * Applies the same HTTP configuration used in production bootstrap to a Nest application instance.
 * Sharing this function between main.ts and the integration test harness keeps behaviour identical
 * (prefix, security headers, middleware stack, docs routes, CORS, validation, etc.).
 */
export async function configureApp(app: INestApplication): Promise<void> {
  const env = getEnv();
  TelemetryMetrics.refreshEnvironment();
  // Request correlation & structured logging come first.
  app.use(requestIdMiddleware);
  app.use(requestLoggingMiddleware);
  app.use(metricsMiddleware);

  // Global validation pipe mirrors production defaults.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // CORS policy matches main bootstrap.
  const corsOrigins = env.service.corsOrigins.length
    ? env.service.corsOrigins
    : [...DEFAULT_CORS_ORIGINS];

  app.enableCors({
    origin: corsOrigins,
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

  // Security headers identical to production bootstrap.
  app.use((_req, res, next) => {
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

  // Global rate limiting mirrors Express bootstrap defaults.
  app.use(apiLimiter);
  app.use((req, res, next) => {
    const rateLimitInfo = (req as any).rateLimit;
    if (rateLimitInfo) {
      if (
        rateLimitInfo.limit !== undefined &&
        !res.getHeader("RateLimit-Limit")
      ) {
        res.setHeader("RateLimit-Limit", String(rateLimitInfo.limit));
      }

      if (
        rateLimitInfo.remaining !== undefined &&
        !res.getHeader("RateLimit-Remaining")
      ) {
        res.setHeader("RateLimit-Remaining", String(rateLimitInfo.remaining));
      }

      if (!res.getHeader("RateLimit-Reset") && rateLimitInfo.resetTime) {
        const resetTime = rateLimitInfo.resetTime;
        const resetSeconds =
          resetTime instanceof Date
            ? Math.max(0, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
            : Math.max(0, Math.ceil(resetTime / 1000));
        res.setHeader("RateLimit-Reset", String(resetSeconds));
      }
    }

    next();
  });

  // Serve docs once per underlying HTTP adapter instance.
  const httpAdapter = app.getHttpAdapter();
  const server =
    httpAdapter && "getInstance" in httpAdapter
      ? (httpAdapter as any).getInstance?.()
      : undefined;

  if (server && !Reflect.get(server, DOCS_ROUTE_FLAG)) {
    registerDocsRoutes(server);
    Reflect.set(server, DOCS_ROUTE_FLAG, true);
  }

  if (server && !Reflect.get(server, METRICS_ROUTE_FLAG)) {
    server.get("/metrics", prometheusMetricsHandler);
    Reflect.set(server, METRICS_ROUTE_FLAG, true);
  }

  // Align API surface with production (e.g. /api/v1/chat/...).
  app.setGlobalPrefix("api/v1");
}
