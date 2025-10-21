# Quick Start Guide

This guide helps you get the chat backend running in under 5 minutes.

## Prerequisites

- Node.js 18+ and npm
- (Optional) Docker for PostgreSQL
- (Optional) AWS account for S3 uploads

## Quick Setup Options

### Option 1: Mock Mode (Fastest - No Database Required)

Perfect for local development, testing, and exploring the API.

```bash
# 1. Clone and install
git clone <repository-url>
cd college-id-signup-1
npm install

# 2. Set environment to mock mode
cp .env.example .env
# Edit .env and set: PRISMA_CLIENT_MODE=mock

# 3. Start the server
npm run start:dev

# Server runs on http://localhost:3001
```

**What you get:**
- ✅ All REST and Socket.IO APIs functional
- ✅ In-memory data storage (resets on restart)
- ✅ No database setup needed
- ✅ Perfect for testing and development

**Limitations:**
- ❌ Data not persisted between restarts
- ❌ Integration tests requiring real DB are skipped

### Option 2: Database Mode (Full Persistence)

For production-like testing with persistent data.

```bash
# 1. Start PostgreSQL with Docker
docker-compose up postgres -d

# 2. Install dependencies
npm install

# 3. Set environment to database mode
cp .env.example .env
# Edit .env and set:
#   PRISMA_CLIENT_MODE=database
#   DATABASE_URL=postgresql://postgres:password@localhost:5432/chat_backend_db

# 4. Run migrations
npm run prisma:generate
npm run prisma:migrate

# 5. (Optional) Seed test data
npm run prisma:seed

# 6. Start the server
npm run start:dev
```

**What you get:**
- ✅ All features from mock mode
- ✅ Persistent data storage
- ✅ Full integration test suite
- ✅ Production-ready setup

## Verify Setup

### Check Health

```bash
curl http://localhost:3001/health
```

Expected response:
```json
{
  "status": "OK",
  "timestamp": "2025-10-20T...",
  "uptime": 1.234
}
```

### Check Database Health

```bash
curl http://localhost:3001/api/v1/health/database
```

Mock mode response:
```json
{
  "status": "healthy",
  "mode": "mock",
  "latency": "0ms"
}
```

Database mode response:
```json
{
  "status": "healthy",
  "latency": "5ms"
}
```

## Test the Chat API

### Create a conversation (REST)

```bash
curl -X POST http://localhost:3001/api/v1/chat/conversations \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-123",
    "type": "DIRECT",
    "participantIds": ["user-456"]
  }'
```

### Connect via WebSocket

```javascript
const io = require('socket.io-client');
const socket = io('http://localhost:3001');

socket.on('connect', () => {
  console.log('Connected!');
  
  socket.emit('join_conversation', {
    userId: 'user-123',
    conversationId: 'conv-id'
  });
});
```

## Environment Variables

### Required (Both Modes)

```env
PORT=3001
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000
```

### Mock Mode

```env
PRISMA_CLIENT_MODE=mock
```

### Database Mode

```env
PRISMA_CLIENT_MODE=database
DATABASE_URL=postgresql://postgres:password@localhost:5432/chat_backend_db
```

### Optional (AWS S3 for file uploads)

```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-key-id
AWS_SECRET_ACCESS_KEY=your-secret-key
S3_BUCKET_NAME=your-bucket-name
```

## Running Tests

### With Mock Mode (Default)

```bash
npm test
```

### With Database Mode

```bash
export PRISMA_CLIENT_MODE=database
npm test
```

### With Coverage

```bash
npm run test:cov
```

## Switching Between Modes

You can switch between mock and database modes by changing the `PRISMA_CLIENT_MODE` environment variable:

```bash
# Switch to mock
export PRISMA_CLIENT_MODE=mock
npm run start:dev

# Switch to database
export PRISMA_CLIENT_MODE=database
npm run start:dev
```

The server will log which mode it's using on startup:

**Mock mode:**
```
⚠️  Prisma mock client active (DATABASE_URL not set). Set PRISMA_CLIENT_MODE=database after configuring PostgreSQL.
⚠️  Prisma mock mode enabled - database operations run against in-memory stubs.
```

**Database mode:**
```
✅ Database connected successfully
✅ Database connection test passed
Successfully connected to PostgreSQL database via singleton
```

## Next Steps

- Read [API Documentation](../API_DOCUMENTATION.md)
- Review [Chat Implementation](../CHAT_IMPLEMENTATION_COMPLETE.md)
- Understand [No-Auth Policy](../scope/no-auth-policy.md)
- Check [Monitoring Guide](../operations/monitoring.md)

## Troubleshooting

### Port Already in Use

```bash
# Change port in .env
PORT=3002
```

### Database Connection Failed

```bash
# Verify PostgreSQL is running
docker ps

# Check connection string
echo $DATABASE_URL

# Reset database
docker-compose down -v
docker-compose up postgres -d
npm run prisma:migrate
```

### Mock Mode Not Working

```bash
# Verify environment variable
echo $PRISMA_CLIENT_MODE

# Should output: mock

# If not set:
export PRISMA_CLIENT_MODE=mock
```

## Support

For issues or questions:
- Check existing documentation in `docs/`
- Review error logs for specific error messages
- Ensure environment variables match your chosen mode
