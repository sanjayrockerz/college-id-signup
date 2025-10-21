# Express to NestJS Migration Guide

**Effective Date**: 2025-10-20  
**Migration Status**: Complete  
**Architecture**: Single NestJS HTTP server

## Overview

The chat backend has been consolidated from a dual-server architecture (Express + NestJS) to a **single NestJS application**. This guide helps developers and API consumers understand the changes and migrate their integrations.

## What Changed

### Before (Dual Server)
```
┌─────────────────────────┐
│  Express Server         │
│  Port: 3000             │
│  Routes:                │
│  - /health              │
│  - /api/id-card/*       │
└─────────────────────────┘

┌─────────────────────────┐
│  NestJS Server          │
│  Port: 3001             │
│  Routes:                │
│  - /api/v1/health       │
│  - /api/v1/chat/*       │
│  - /api/v1/users/*      │
│  - /api/v1/posts/*      │
│  - /api/v1/feed/*       │
│  - /api/v1/connections/*│
│  - /api/v1/interactions/*│
│  - /api/v1/upload/*     │
└─────────────────────────┘
```

### After (Single Server)
```
┌─────────────────────────┐
│  NestJS Server          │
│  Port: 3001             │
│  Routes:                │
│  - /api/v1/health       │
│  - /api/v1/chat/*       │
│  - /api/v1/users/*      │
│  - /api/v1/posts/*      │
│  - /api/v1/feed/*       │
│  - /api/v1/connections/*│
│  - /api/v1/interactions/*│
│  - /api/v1/upload/*     │
│  - /api/v1/idcard/*     │ <- Migrated from Express
└─────────────────────────┘
```

## Route Migration Table

### ID Card Verification Routes

| Old (Express) | New (NestJS) | Status | Notes |
|---------------|--------------|--------|-------|
| `POST /api/id-card/upload` | `POST /api/v1/idcard/upload` | ✅ Migrated | Enhanced with mobile optimization |
| `POST /api/id-card/verify` | `POST /api/v1/idcard/verify` | ✅ Migrated | Same functionality |
| `POST /api/id-card/verify/:uploadId` | `POST /api/v1/idcard/verify/:uploadId` | ✅ Migrated | Same functionality |
| `GET /api/id-card/history` | `GET /api/v1/idcard/history` | ✅ Migrated | Same functionality |
| `GET /api/id-card/status` | `GET /api/v1/idcard/verification/:id` | ✅ Renamed | More RESTful naming |
| `GET /api/id-card/mobile/feed` | `GET /api/v1/idcard/mobile/feed` | ✅ Added | New mobile feature |
| `PUT /api/id-card/resubmit` | **Removed** | ⚠️ Deprecated | Use `/upload` with new image |
| `GET /api/id-card/admin/pending` | **Removed** | ⚠️ Moved | Admin portal handles this |
| `PUT /api/id-card/admin/review/:id` | **Removed** | ⚠️ Moved | Admin portal handles this |

### Health Check Routes

| Old (Express) | New (NestJS) | Status | Notes |
|---------------|--------------|--------|-------|
| `GET /health` | `GET /api/v1/health` | ✅ Migrated | Enhanced with more details |
| `GET /health/database` | `GET /api/v1/health/database` | ✅ Migrated | Mock mode support added |

## Code Migration Examples

### Frontend/Client Code

#### Old (Express)
```typescript
// ID Card Upload - Express
const response = await fetch('http://localhost:3000/api/id-card/upload', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    userId: 'user-123',
    image: base64Image,
  }),
});
```

#### New (NestJS)
```typescript
// ID Card Upload - NestJS
const response = await fetch('http://localhost:3001/api/v1/idcard/upload', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-user-id': 'user-123', // Optional: for attribution
  },
  body: JSON.stringify({
    image: base64Image,
  }),
});
```

### Environment Variables

#### Old Configuration
```bash
# .env (Express)
PORT=3000
FRONTEND_URL=http://localhost:3000
DATABASE_URL=postgresql://...
```

#### New Configuration
```bash
# .env (NestJS)
PORT=3001
CORS_ORIGIN=http://localhost:3000
DATABASE_URL=postgresql://...
PRISMA_CLIENT_MODE=mock  # Optional: for development without DB
```

### NPM Scripts

#### Old Commands
```bash
# Express server
npm start              # Starts Express on port 3000
npm run dev            # Express with nodemon
npm run start:express  # Explicit Express start
```

#### New Commands
```bash
# NestJS server
npm start              # Starts NestJS on port 3001
npm run start:dev      # NestJS with watch mode
npm run start:prod     # Production build
npm run start:debug    # Debug mode
```

## Breaking Changes

### 1. Port Change
- **Old**: Express on port 3000
- **New**: NestJS on port 3001
- **Action**: Update all client configurations to use port 3001

### 2. Route Prefix
- **Old**: `/api/id-card/*`
- **New**: `/api/v1/idcard/*`
- **Action**: Update all API calls to include `/api/v1` prefix

### 3. Admin Routes Removed
- **Old**: `/api/id-card/admin/*` routes existed
- **New**: Admin functionality moved to separate admin portal
- **Action**: Use admin portal for verification reviews

### 4. Resubmit Endpoint Removed
- **Old**: `PUT /api/id-card/resubmit`
- **New**: Use `POST /api/v1/idcard/upload` with new image
- **Action**: Re-upload instead of resubmitting

## Migration Checklist

### For Backend Developers
- [x] Express server files moved to `src/deprecated/`
- [x] package.json scripts updated
- [x] NestJS routes tested and working
- [x] Documentation updated
- [ ] Monitor logs for 30 days (no rollback needed)
- [ ] Delete deprecated files after 30 days

### For Frontend Developers
- [ ] Update API base URL from `localhost:3000` to `localhost:3001`
- [ ] Update all `/api/id-card/*` calls to `/api/v1/idcard/*`
- [ ] Remove references to admin review endpoints (if any)
- [ ] Update resubmit logic to use upload endpoint
- [ ] Test all ID card verification flows
- [ ] Update environment variables

### For DevOps/Infrastructure
- [ ] Update load balancer to point to port 3001
- [ ] Update monitoring dashboards for new routes
- [ ] Update health check configurations
- [ ] Update firewall rules (remove port 3000)
- [ ] Update API gateway configurations
- [ ] Verify logging and metrics collection

## Testing

### Health Check Verification
```bash
# Test general health
curl http://localhost:3001/api/v1/health

# Expected response
{
  "status": "ok",
  "timestamp": "2025-10-20T...",
  "database": {
    "overall": "mock",  # or "healthy" with database
    "operationsSuccessful": true
  }
}
```

### ID Card Upload Test
```bash
# Test ID card upload
curl -X POST http://localhost:3001/api/v1/idcard/upload \
  -H "Content-Type: application/json" \
  -H "x-user-id: test-user-1" \
  -d '{"image":"data:image/jpeg;base64,..."}'

# Expected response
{
  "success": true,
  "uploadId": "upload-123",
  "message": "ID card uploaded successfully"
}
```

### Conversation Creation Test
```bash
# Test chat conversation
curl -X POST http://localhost:3001/api/v1/chat/conversations \
  -H "Content-Type: application/json" \
  -d '{"userId":"user-1","participantIds":["user-2"],"type":"DIRECT"}'

# Expected response
{
  "success": true,
  "conversation": {...}
}
```

## Rollback Procedure

If critical issues arise, you can temporarily rollback to Express:

```bash
# 1. Restore Express files
cp src/deprecated/app.ts.old src/app.ts
cp src/deprecated/server.js.old src/server.js

# 2. Update package.json start script manually
# Change "start": "nest start" to "start": "node src/server.js"

# 3. Restart
npm start
```

**Note**: This is for emergency use only. Contact the development team immediately if rollback is needed.

## Benefits of NestJS Architecture

### 1. Type Safety
```typescript
// NestJS with TypeScript decorators
@Controller('idcard')
export class IdCardController {
  @Post('upload')
  async upload(@Body() dto: UploadIdCardDto) {
    // Automatic validation
    // Type-safe throughout
  }
}
```

### 2. Dependency Injection
```typescript
// Clean service composition
@Injectable()
export class IdCardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly upload: UploadService,
  ) {}
}
```

### 3. Testing
```typescript
// Built-in testing utilities
describe('IdCardController', () => {
  let controller: IdCardController;
  
  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [IdCardController],
    }).compile();
    
    controller = module.get<IdCardController>(IdCardController);
  });
});
```

### 4. Modularity
```typescript
// Clear module boundaries
@Module({
  imports: [PrismaModule, UploadModule, CommonModule],
  controllers: [IdCardController],
  providers: [IdCardService, IdCardRepository],
  exports: [IdCardService],
})
export class IdCardModule {}
```

## Support

### Questions?
- Check the [Quick Start Guide](../setup/QUICK_START.md)
- Review the [Deprecated Files README](../../src/deprecated/README.md)
- Contact the development team

### Found a Bug?
- Check if it exists in both old and new implementations
- Report with steps to reproduce
- Include request/response examples

### Need Help Migrating?
- Review this guide thoroughly
- Test in development environment first
- Contact team for assistance with complex integrations

## Timeline

- **2025-10-20**: Migration complete, Express deprecated
- **2025-11-20**: Express files scheduled for deletion (30 days)
- **Ongoing**: Monitor for issues, update documentation as needed

---

**Last Updated**: 2025-10-20  
**Version**: 1.0  
**Status**: Active
