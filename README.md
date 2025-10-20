# Chat Backend - Anonymous Public API

**Anonymous real-time messaging microservice** - Provides REST and Socket.IO APIs for chat transport and persistence. No authentication required; explicit `userId` in requests.

> ⚠️ **Repository Migration**: This repository was renamed from `college-id-signup` to `chat-backend` on 20 October 2025 to better reflect its purpose as a chat transport and persistence backend.
>
> **Update your Git remotes**:
> ```bash
> git remote set-url origin https://github.com/sanjayrockerz/chat-backend.git
> ```
> GitHub automatically redirects the old URL for convenience.

> 🎉 **v2.0.0 Released**: See [RELEASE_NOTES_v2.0.0.md](RELEASE_NOTES_v2.0.0.md) for breaking changes, migration guide, and new features.

> ⚡ **Architecture Update (2025-10-20)**: Migrated from dual-server (Express + NestJS) to **single NestJS architecture**. All Express routes have been migrated. See [docs/migration/EXPRESS_TO_NESTJS.md](docs/migration/EXPRESS_TO_NESTJS.md) for details.

---

## 🏛️ Governance & Operations (NEW)

**Production-Ready Transformation** (2025-10-20): Comprehensive governance framework established to transform this repository into a production-grade chat transport service. All technical decisions, operational procedures, and quality standards are now documented.

### 📋 Governance Documentation

**Policy & Control**:
- 📐 [**ADR-001: Scope Boundary**](docs/governance/ADR-001-SCOPE-BOUNDARY.md) - Defines in-scope (chat transport/persistence) vs. out-of-scope (auth, college domain, frontend)
- 👥 [**Ownership Matrix**](docs/governance/OWNERSHIP-MATRIX.md) - RACI model with Directly Responsible Individuals for all components
- 🔄 [**Change Control**](docs/governance/CHANGE-CONTROL.md) - 4-tier approval process for deployments and schema changes
- 🔒 [**Threat Model**](docs/governance/THREAT-MODEL.md) - STRIDE analysis, attack surface mapping, compensating controls for no-auth architecture
- 🗄️ [**Data Retention**](docs/governance/DATA-RETENTION.md) - GDPR/CCPA compliance, data lifecycle, automated cleanup procedures
- 🚨 [**Incident Response**](docs/governance/INCIDENT-RESPONSE.md) - Runbooks for error spikes, connection storms, database saturation, cascading failures

### 📊 Observability & Monitoring

**Operational Excellence**:
- 📈 [**Logging, Metrics, Tracing**](docs/observability/LOGGING-METRICS-TRACING.md) - Winston/Pino structured logging, Prometheus metrics, OpenTelemetry tracing, CloudWatch integration
- 🔔 [**Alerting Strategy**](docs/observability/ALERTING-STRATEGY.md) - SLO-based alerts, PagerDuty integration, on-call rotation, error budget monitoring

### 🔧 CI/CD & Quality

**Automated Quality Gates**:
- ⚙️ [**Pipeline Specification**](docs/ci-cd/PIPELINE-SPECIFICATION.md) - Branch protection, TypeScript strict mode, ESLint zero-tolerance, 75% coverage requirement, security scanning (Snyk/Trivy/CodeQL), artifact signing, blue/green deployment, automated rollback

### 📏 Baseline Metrics

**Current System State**:
- 📊 [**Baseline Metrics Report**](docs/baselines/BASELINE-METRICS.md) - Captured 2025-10-20: File counts, build performance (1.26s), artifact size (1.3MB), test coverage gaps, security vulnerabilities (9), technical debt markers (20+ TODOs), scope compliance analysis

**Key Findings**:
- ✅ **Build**: Fast and successful (1.26 seconds, 1.3 MB artifact)
- ✅ **Linting**: Clean (ESLint passes)
- ⚠️ **Security**: 9 npm vulnerabilities (7 moderate, 2 high) - fix in progress
- ⚠️ **Test Coverage**: Minimal (44 tests skipped, 1 passed) - comprehensive suite planned
- ⚠️ **Scope Compliance**: 40% in-scope, 60% out-of-scope code - cleanup in next iteration

### 🎯 Transformation Roadmap

**Iteration 4** (Scope Enforcement):
- Remove auth module (relocate to API gateway)
- Remove college domain code (idcard, connections, interactions)
- Remove social features (feed, posts)
- Implement banned import detection
- **Target**: Reduce from 88 files → ~40 files

**Iteration 5** (Quality Infrastructure):
- Implement structured logging (Winston/Pino)
- Add Prometheus metrics endpoint
- Configure OpenTelemetry tracing
- Write comprehensive test suite (>75% coverage)
- Fix all security vulnerabilities
- Set up CI/CD pipeline (GitHub Actions)

**Iteration 6** (Production Hardening):
- Deploy to staging environment
- Run load tests (capture performance baselines)
- Configure PagerDuty integration
- Set up Grafana dashboards
- Test incident response runbooks
- Production deployment with monitoring

---

## Scope and Trust Model

**This service is a chat transport and persistence backend only.** It provides real-time messaging, conversation management, and message history without implementing user authentication or authorization.

### Identity-Agnostic Design

- ✅ **In Scope**: Message transport, persistence, real-time delivery via Socket.IO
- ❌ **Out of Scope**: Authentication (JWT, sessions, passwords), authorization (access control), user registration/login

### Trust Boundaries

**userId is untrusted metadata**: This service treats `userId` as an opaque string for message attribution only. It does NOT validate user identity or enforce access control.

**Upstream authentication required**: This service is designed to run behind an authenticated API gateway or upstream service that:
- Authenticates users (JWT, OAuth, sessions)
- Validates credentials and permissions
- Forwards verified `userId` to this backend
- Enforces conversation access control

**Security model**: Since this service does not authenticate users, it relies on:
- IP-based rate limiting (protects against anonymous abuse)
- Input validation (all payloads validated with class-validator)
- Network segmentation (should run on private network, not exposed publicly)
- Upstream authorization (gateway enforces "who can access what")

⚠️ **Production Warning**: Do NOT expose this service directly to public clients. Always route through an authenticated upstream gateway. See [docs/scope/no-auth-policy.md](docs/scope/no-auth-policy.md) for architecture details.

📖 **Integration Guide**: See [docs/scope/upstream-integration.md](docs/scope/upstream-integration.md) for how upstream services should call this backend.

📊 **Operations**: See [docs/operations/monitoring.md](docs/operations/monitoring.md) for monitoring, metrics, alerts, and runbooks.

### Rate Limiting

To protect against abuse, all endpoints are rate-limited by IP address:

- **General API**: 100 requests per 15 minutes
- **Messaging**: 200 messages per 15 minutes
- **File Uploads**: 10 uploads per 15 minutes
- **Admin Operations**: 20 requests per 15 minutes
- **Write Operations**: 30 requests per 15 minutes (POST/PUT/DELETE)

Rate limit headers are included in responses:
- `RateLimit-Limit`: Total requests allowed
- `RateLimit-Remaining`: Requests remaining
- `RateLimit-Reset`: Time when limit resets

## Features

- 💬 **Real-time Messaging** - Socket.IO powered chat with direct messages and group conversations
- 📱 **Social Feed** - Posts, interactions, connections, and push notifications
- 🎓 **College Verification** - ID card upload and verification system
- 🔍 **Search** - Find users and conversations
- 📊 **Analytics** - Message read receipts, typing indicators, online status
- 📁 **File Uploads** - AWS S3 integration for images and attachments

## Tech Stack

- **Runtime**: Node.js
- **Framework**: NestJS (TypeScript)
- **Database**: PostgreSQL with Prisma ORM
- **Real-time**: Socket.IO
- **Storage**: AWS S3
- **API**: REST + WebSocket
- **Testing**: Jest
- **Validation**: class-validator + class-transformer

## Getting Started

> 🚀 **New to this project?** Check out the [Quick Start Guide](docs/setup/QUICK_START.md) to get running in under 5 minutes!

### Prerequisites

- Node.js 18+ and npm
- PostgreSQL 14+
- AWS account (for S3 uploads)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd college-id-signup-1
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
```env
# Prisma / Database
PRISMA_CLIENT_MODE=auto
DATABASE_URL=postgresql://postgres:password@localhost:5432/chat_backend_db?schema=public

# Server
PORT=3001
NODE_ENV=development

# AWS S3
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-key-id
AWS_SECRET_ACCESS_KEY=your-secret
AWS_S3_BUCKET=your-bucket

# Frontend
CORS_ORIGIN=http://localhost:3000
FRONTEND_URL=http://localhost:3000
CLIENT_URL=http://localhost:3000
```

> 💡 **No Postgres locally?** Set `PRISMA_CLIENT_MODE=mock` to run the API and tests without a database. Switch to `database` once PostgreSQL is provisioned to avoid silent fallbacks.

4. Run database migrations:
```bash
# Only needed for database mode (PRISMA_CLIENT_MODE=database)
npm run prisma:generate
npm run prisma:migrate
```

> 💡 **Using mock mode?** Skip this step. Mock mode doesn't require migrations or a database connection.

5. (Optional) Seed the database:
```bash
npm run prisma:seed
```

### Running the Application

**Development mode:**
```bash
# Express server
npm run start:express:dev

# NestJS server
npm run start:dev

# Simple server (fastest startup)
npm run serve:quick
```

**Production mode:**
```bash
npm run build
npm run start:prod
```

### Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:cov

# Run e2e tests
npm run test:e2e
```

## Project Structure

```
college-id-signup-1/
├── src/
│   ├── chat-backend/          # NestJS chat module
│   │   ├── controllers/       # Chat controllers
│   │   ├── services/          # Business logic
│   │   └── repositories/      # Data access
│   ├── routes/                # Express routes
│   │   ├── chat.js           # Chat endpoints
│   │   ├── conversations.js  # Conversation endpoints
│   │   ├── idcard.ts         # ID verification
│   │   └── upload.js         # File uploads
│   ├── socket/                # Socket.IO handlers
│   │   └── handlers.js       # Real-time event handlers
│   ├── config/                # Configuration
│   ├── middleware/            # Express middleware
│   ├── posts/                 # Social feed module
│   ├── feed/                  # Feed module
│   ├── connections/           # Social connections
│   ├── interactions/          # Post interactions
│   └── user/                  # User module
├── prisma/
│   ├── schema.prisma         # Database schema
│   ├── seed.ts               # Database seeding
│   └── migrations/           # Migration files
├── test/                     # Test files
└── package.json
```

## API Documentation

See [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) for detailed endpoint documentation.

### Quick API Examples

**Create a conversation:**
```bash
curl -X POST http://localhost:3001/api/v1/chat/conversations \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-123",
    "participantIds": ["user-456"],
    "type": "DIRECT_MESSAGE"
  }'
```

**Send a message:**
```bash
curl -X POST http://localhost:3001/api/v1/chat/conversations/conv-123/messages \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-123",
    "content": "Hello!",
    "type": "TEXT"
  }'
```

**Connect to Socket.IO:**
```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:3001', {
  query: { userId: 'user-123' }
});

socket.emit('send_message', {
  userId: 'user-123',
  conversationId: 'conv-123',
  content: 'Real-time message!',
  type: 'TEXT'
});
```

## Database Schema

The application uses Prisma ORM with the following main models:

- **User** - User accounts and profiles
- **Conversation** - Chat conversations (DM or group)
- **ConversationUser** - Conversation membership
- **Message** - Chat messages
- **MessageRead** - Read receipts
- **Attachment** - File attachments
- **Post** - Social feed posts
- **Interaction** - Likes, comments, shares
- **Connection** - User connections

View the full schema in `prisma/schema.prisma`.

## Scripts

```bash
# Development
npm run dev                    # Start Express dev server
npm run start:dev              # Start NestJS dev server
npm run serve:quick            # Quick start (simple server)

# Build & Production
npm run build                  # Build TypeScript
npm start                      # Start production server

# Database
npm run prisma:generate        # Generate Prisma Client
npm run prisma:migrate         # Run migrations
npm run prisma:seed            # Seed database
npm run prisma:studio          # Open Prisma Studio
npm run db:reset               # Reset database

# Testing
npm test                       # Run tests
npm run test:watch             # Watch mode
npm run test:cov               # Coverage report

# Code Quality
npm run lint                   # Run ESLint
npm run format                 # Format with Prettier
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | ✅ |
| `PORT` | Server port (default: 3001) | ❌ |
| `NODE_ENV` | Environment (development/production) | ❌ |
| `AWS_REGION` | AWS region for S3 | ✅ |
| `AWS_ACCESS_KEY_ID` | AWS access key | ✅ |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key | ✅ |
| `AWS_S3_BUCKET` | S3 bucket name | ✅ |
| `FRONTEND_URL` | Frontend URL for CORS | ✅ |
| `CORS_ORIGIN` | Allowed CORS origin | ✅ |

## Security Considerations

⚠️ **IMPORTANT**: This application currently has no authentication. Before deploying to production:

1. **Implement Authentication**
   - Add JWT or OAuth authentication
   - Protect all endpoints with authentication middleware
   - Validate userId ownership

2. **Add Authorization**
   - Implement role-based access control
   - Verify conversation membership before operations
   - Add admin roles for verification endpoints

3. **Secure Communications**
   - Use HTTPS in production
   - Enable secure WebSocket connections (WSS)
   - Implement request signing

4. **Rate Limiting**
   - Add per-user rate limiting
   - Implement abuse detection
   - Add CAPTCHA for sensitive operations

5. **Input Validation**
   - Validate all user inputs
   - Sanitize content to prevent XSS
   - Implement file upload restrictions

6. **Data Privacy**
   - Add data encryption at rest
   - Implement proper logging without sensitive data
   - Follow GDPR/privacy regulations

## Troubleshooting

### Database Connection Issues
```bash
# Check if PostgreSQL is running
pg_isready

# Reset database
npm run db:reset
```

### Prisma Client Issues
```bash
# Regenerate Prisma Client
npm run prisma:generate
```

### Port Already in Use
```bash
# Kill process on port 3001
lsof -ti:3001 | xargs kill -9
```

### Module Not Found
```bash
# Clean install
rm -rf node_modules package-lock.json
npm install
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License.

## Support

For questions or issues:
- Open an issue on GitHub
- Check existing documentation
- Review API documentation

---

**Note**: Remember to implement proper authentication and security measures before deploying to production!
