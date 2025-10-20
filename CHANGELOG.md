# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.0] - 2025-10-20

### 🚨 BREAKING CHANGES

#### Authentication Removed
- **REMOVED**: All authentication endpoints (`/api/auth/*`)
  - `/api/auth/register` - User registration
  - `/api/auth/login` - User login
  - `/api/auth/logout` - User logout
  - `/api/auth/me` - Get current user
  - `/api/auth/profile` - Update profile
  - `/api/auth/password` - Change password
  - `/api/auth/refresh` - Refresh tokens
  - `/api/auth/verify` - Email verification
  - `/api/auth/forgot-password` - Password reset
  - `/api/auth/reset-password` - Complete reset

- **REMOVED**: Authentication middleware
  - `src/middleware/auth.js`
  - `src/middleware/auth.ts`
  - `src/middleware/socketAuth.js`
  - `src/middleware/socketAuth.ts`

- **REMOVED**: JWT token validation
  - No longer requires `Authorization: Bearer <token>` header
  - No longer returns auth tokens in responses

- **REMOVED**: Environment variables
  - `JWT_SECRET`
  - `REFRESH_TOKEN_SECRET`
  - `TOKEN_EXPIRY`
  - `REFRESH_TOKEN_EXPIRY`
  - `AUTH_SALT_ROUNDS`
  - `DISABLE_AUTH`

#### API Contract Changes
- **CHANGED**: All endpoints now require explicit `userId` parameter
  - REST API: Add `userId` to request body (POST/PUT) or query params (GET)
  - Socket.IO: Add `userId` to all event payloads
  - `userId` is treated as opaque metadata (NOT validated)

#### Repository Renamed
- **RENAMED**: `college-id-signup` → `chat-backend`
- **RENAMED**: npm package `college-id-signup-backend` → `chat-backend`
- **RENAMED**: Docker containers `college-social-*` → `chat-backend-*`
- **RENAMED**: Database `college_social_db` → `chat_backend_db`

### ✨ Added

#### Security Controls
- **Added**: Validation middleware (`src/middleware/validation.ts`)
  - 11 validation functions for input sanitization
  - Size limits enforcement (10MB JSON, 25MB attachments, 10k chars)
  - File type whitelisting (images, documents)
  - XSS prevention (sanitizeInput)
  - Pagination validation

- **Added**: Logging infrastructure (`src/middleware/logging.ts`)
  - UUID-based request IDs for tracing
  - Structured JSON logging
  - Automatic PII redaction (passwords, tokens, secrets)
  - Metrics collection (requests, errors, latencies)
  - `/metrics` endpoint for monitoring

- **Added**: Rate limiting (5 tiers)
  - General API: 100 req/15min
  - Messaging: 200 req/15min
  - Uploads: 10 req/15min
  - Write Operations: 30 req/15min
  - Admin: 20 req/15min

- **Added**: Security headers
  - HSTS with preload
  - Content Security Policy
  - Referrer-Policy: strict-origin-when-cross-origin
  - Permissions-Policy
  - X-Frame-Options, X-Content-Type-Options, X-XSS-Protection

#### Monitoring & Observability
- **Added**: Health check endpoints
  - `GET /health` - Basic health check
  - `GET /health/database` - Database connectivity check

- **Added**: Metrics endpoint
  - `GET /metrics` - JSON metrics (requests, errors, latencies, connections)

- **Added**: Request tracing
  - X-Request-ID header in all responses
  - Client-provided request IDs preserved
  - Correlation across logs and requests

#### Documentation
- **Added**: Comprehensive operational documentation
  - [docs/operations/monitoring.md](docs/operations/monitoring.md) - 600+ lines
    - 30+ key metrics
    - 3 dashboard specifications
    - 11 alerting rules
    - 5 detailed runbooks
    - Scaling strategies

- **Added**: Architecture documentation
  - [docs/scope/no-auth-policy.md](docs/scope/no-auth-policy.md) - No-auth rationale
  - [docs/scope/upstream-integration.md](docs/scope/upstream-integration.md) - Integration patterns

- **Added**: Migration documentation
  - [RELEASE_NOTES_v2.0.0.md](RELEASE_NOTES_v2.0.0.md) - Complete release notes
  - [VERIFICATION_AND_SIGNOFF.md](VERIFICATION_AND_SIGNOFF.md) - System verification
  - [REPOSITORY_REBRAND_COMPLETE.md](REPOSITORY_REBRAND_COMPLETE.md) - Rebrand guide

#### Testing
- **Added**: Anonymous access integration tests
  - `test/chat-api.integration.spec.ts` - 25+ REST API tests
  - `test/socket-api.integration.spec.ts` - 20+ Socket.IO tests
  - Validates no authentication required
  - Validates userId requirement
  - Validates rate limiting and request tracing

### 🔧 Changed

#### API Behavior
- **CHANGED**: REST API endpoints require `userId` in requests
  - Before: `Authorization: Bearer <token>` header
  - After: `userId` in body/query parameter

- **CHANGED**: Socket.IO events require `userId` in payloads
  - Before: `auth: { token }` in connection options
  - After: `userId` in event data

- **CHANGED**: Error responses
  - No longer returns 401 Unauthorized
  - Returns 400 Bad Request for missing/invalid userId
  - Returns 429 Too Many Requests for rate limit exceeded

#### Configuration
- **CHANGED**: CORS configuration
  - Multi-origin support via `CORS_ORIGIN` env var (comma-separated)
  - Exposed rate limit headers in responses
  - MaxAge set to 3600 seconds

- **CHANGED**: Database naming
  - Default database name changed to `chat_backend_db`
  - Update `DATABASE_URL` environment variable accordingly

### 📚 Documentation

- **Updated**: README.md with v2.0 migration notice
- **Updated**: API documentation for anonymous access patterns
- **Updated**: Docker Compose configuration
- **Updated**: All references from `college-id-signup` to `chat-backend`

### 🔒 Security

- **Improved**: Security posture with 5-layer defense
  1. Input validation (11 validators)
  2. Rate limiting (5 tiers, IP-based)
  3. Request tracing (UUID correlation)
  4. Security headers (6 headers)
  5. Monitoring & alerting (11 rules)

- **Improved**: Trust boundary clarity
  - Explicit documentation that `userId` is untrusted
  - Clear upstream authentication requirements
  - Production deployment warnings

### ⚠️ Deprecated

- **Deprecated**: v1.x branch with authentication
  - v1.9.0 is last version with authentication
  - v1.x will reach end-of-life on 2025-11-30
  - No further updates to v1.x branch

### 🐛 Fixed

- **Fixed**: TypeScript compilation with validation middleware
- **Fixed**: Supertest import in integration tests
- **Fixed**: Socket.IO client auth property type error

### 📦 Dependencies

- **Added**: `socket.io-client@4.8.1` (dev) - Socket.IO testing
- **Updated**: No dependency version changes

### 🗑️ Removed

- **Removed**: JWT authentication dependencies (retained for future removal)
- **Removed**: Authentication middleware files
- **Removed**: Auth-related environment variables
- **Removed**: Authentication tests and fixtures

---

## [1.9.0] - 2025-10-15 (DEPRECATED)

### Last Release with Authentication

This is the final release supporting authentication. All future development will be on the v2.0+ branch without authentication.

#### Features
- JWT-based authentication
- User registration and login
- Password management
- Token refresh
- Email verification

#### Deprecation Notice
- Authentication features deprecated as of 2025-10-20
- Use v2.0.0+ for new deployments
- v1.9.0 enters maintenance mode on 2025-10-20
- v1.9.0 reaches end-of-life on 2025-11-30

---

## Migration Guide

### From v1.x to v2.0

See [RELEASE_NOTES_v2.0.0.md](RELEASE_NOTES_v2.0.0.md) for complete migration guide.

**Quick Steps**:
1. Remove `Authorization` headers from HTTP requests
2. Add `userId` to all request bodies/queries
3. Remove `auth` object from Socket.IO connections
4. Add `userId` to all Socket.IO event payloads
5. Update Git remote to `chat-backend`
6. Update package.json dependency name
7. Update Docker container references
8. Remove auth environment variables

**Estimated Migration Time**: 2-4 hours per service

---

## Release Schedule

- **v2.0.0** (2025-10-20): Authentication removed, repository renamed
- **v2.0.1** (Planned 2025-10-27): Validation middleware route integration, auth file cleanup
- **v2.1.0** (Planned 2025-11-15): User schema auth fields removal
- **v3.0.0** (Planned 2026-Q1): Major feature additions TBD

---

## Links

- [Repository](https://github.com/sanjayrockerz/chat-backend)
- [Release Notes v2.0.0](RELEASE_NOTES_v2.0.0.md)
- [Documentation](docs/)
- [Issues](https://github.com/sanjayrockerz/chat-backend/issues)
- [Migration Guide](RELEASE_NOTES_v2.0.0.md#-migration-guide-for-clients)

---

**Maintained by**: Engineering Team  
**License**: MIT
