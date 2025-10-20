# Dual HTTP Surface Analysis (M4)

**Issue ID**: M4 - Dual HTTP surfaces cause confusion  
**Priority**: Medium  
**Status**: Analysis Complete, Decision Required

## Current State

The codebase contains **TWO separate HTTP servers**:

### 1. NestJS Application (Primary - Currently Active)
- **Entry Point**: `src/main.ts`
- **Framework**: NestJS (enterprise-grade)
- **Port**: 3001 (configured)
- **Start Command**: `npm run start:dev`
- **Global Prefix**: `/api/v1`

**Routes Served**:
- `/api/v1/health` - Health checks
- `/api/v1/chat/*` - Chat/conversation endpoints
- `/api/v1/users/*` - User management
- `/api/v1/posts/*` - Post operations
- `/api/v1/feed/*` - Feed generation
- `/api/v1/connections/*` - Connection management
- `/api/v1/interactions/*` - Interaction tracking
- `/api/v1/idcard/*` - ID card verification
- `/api/v1/upload/*` - File uploads

### 2. Standalone Express Application (Legacy)
- **Entry Point**: `src/app.ts`
- **Framework**: Express (vanilla)
- **Port**: 3000 (default)
- **Start Command**: `npm run start:express` or `npm run start:express:dev`
- **No Global Prefix**

**Routes Served**:
- `/health` - Basic health check
- `/health/database` - Database connectivity check
- `/api/id-card/*` - ID card verification routes
- `/` - Root welcome page

## Overlap Analysis

| Route | Express | NestJS | Conflict? |
|-------|---------|--------|-----------|
| Health checks | `/health`, `/health/database` | `/api/v1/health`, `/api/v1/health/database` | No (different paths) |
| ID card verification | `/api/id-card/*` | `/api/v1/idcard/*` | **Yes - Functional duplication** |
| Chat | ❌ Not implemented | `/api/v1/chat/*` | No |
| Users | ❌ Not implemented | `/api/v1/users/*` | No |
| Posts | ❌ Not implemented | `/api/v1/posts/*` | No |

### Critical Finding: ID Card Route Duplication

Both servers implement ID card verification with different route patterns:

**Express Routes** (src/routes/idcard.ts):
- `POST /api/id-card/upload` - Upload ID card image
- `POST /api/id-card/verify` - Verify uploaded ID
- `GET /api/id-card/history` - Get verification history

**NestJS Routes** (src/idcard/idcard.controller.ts):
- `POST /api/v1/idcard/upload` - Upload ID card image
- `POST /api/v1/idcard/verify` - Verify uploaded ID
- `POST /api/v1/idcard/verify/:uploadId` - Verify specific upload
- `GET /api/v1/idcard/history` - Get verification history
- `GET /api/v1/idcard/verification/:id` - Get specific verification
- `GET /api/v1/idcard/mobile/feed` - Mobile-optimized feed

**Verdict**: NestJS implementation is more feature-complete (mobile feed, specific verification lookup).

## Package.json Scripts

Currently defined server start commands:

```json
{
  "start": "node src/server.js",              // OLD: Express wrapper
  "dev": "nodemon src/server.js",             // OLD: Express dev mode
  "start:dev": "nest start --watch",          // CURRENT: NestJS dev mode
  "serve:quick": "node src/simple-server.js", // MINIMAL: Basic express
  "start:debug": "nest start --debug --watch",// CURRENT: NestJS debug
  "start:prod": "node dist/main",             // CURRENT: NestJS production
  "start:express": "node src/app.js",         // OLD: Standalone Express
  "start:express:dev": "nodemon src/app.js",  // OLD: Express dev
  "start:server": "node src/server.js"        // OLD: Express wrapper
}
```

**Active Scripts**: `start:dev`, `start:debug`, `start:prod` (all NestJS)  
**Legacy Scripts**: `start`, `dev`, `start:express`, `start:express:dev`, `start:server` (all Express)

## Decision Matrix

### Option 1: Deprecate Express Server ✅ **RECOMMENDED**

**Pros**:
- Single source of truth for all routes
- NestJS provides better structure, DI, testability
- NestJS ID card implementation is more feature-complete
- Reduces cognitive load for developers
- Simplifies deployment (one server, one port)
- Aligns with current development (all recent work in NestJS)

**Cons**:
- Requires removing legacy code
- Need to verify no production traffic on Express routes

**Action Items**:
1. Verify no production usage of Express server
2. Archive Express files to `src/deprecated/`
3. Remove Express-specific scripts from package.json
4. Update documentation to reference only NestJS
5. Add deprecation notice to Express README

### Option 2: Consolidate Routes (Hybrid)

**Pros**:
- Gradual migration path
- Can keep Express for specific use cases

**Cons**:
- Maintains complexity
- Two codebases to maintain
- Confusing for new developers
- Testing burden doubled

**Verdict**: Not recommended unless there's a specific requirement.

### Option 3: Document Both (Status Quo)

**Pros**:
- No code changes required
- Maximum flexibility

**Cons**:
- Confusion continues
- Maintenance burden
- Risk of divergence
- No clear migration path

**Verdict**: Not recommended - defers problem.

## Recommended Action Plan

### Phase 1: Verification (Immediate)
1. ✅ Analyze route overlap (COMPLETE)
2. 🔲 Check for any external dependencies on Express routes
3. 🔲 Review monitoring/alerting for Express endpoints
4. 🔲 Search for hardcoded references to `/api/id-card` in frontend

### Phase 2: Migration Prep (1 hour)
1. 🔲 Create `src/deprecated/` directory
2. 🔲 Move Express server files:
   - `src/app.ts` → `src/deprecated/app.ts.old`
   - `src/app.js` → `src/deprecated/app.js.old`
   - `src/server.js` → `src/deprecated/server.js.old`
   - `src/simple-server.js` → `src/deprecated/simple-server.js.old`
3. 🔲 Update package.json: comment out Express scripts with deprecation notice
4. 🔲 Create `docs/migration/EXPRESS_TO_NESTJS.md` guide

### Phase 3: Cleanup (30 minutes)
1. 🔲 Remove deprecated scripts from package.json
2. 🔲 Update all documentation to remove Express references
3. 🔲 Add deprecation notice to README
4. 🔲 Update API documentation to show only NestJS routes

### Phase 4: Validation (15 minutes)
1. 🔲 Run full test suite
2. 🔲 Verify server boots correctly
3. 🔲 Test all ID card endpoints via NestJS
4. 🔲 Update integration tests if needed

## Risk Assessment

### Low Risk
- ✅ NestJS server is already primary and well-tested
- ✅ Express routes are likely unused in production (port 3000 vs 3001)
- ✅ ID card functionality fully replicated in NestJS

### Mitigations
- Keep Express files in `deprecated/` folder (not deleted)
- Document rollback procedure
- Maintain git history for emergency rollback
- Add migration guide for any external clients

## Acceptance Criteria

- [ ] Only one HTTP server defined in package.json
- [ ] All Express server files moved to deprecated folder
- [ ] Documentation updated to reflect NestJS-only architecture
- [ ] All tests pass
- [ ] ID card verification works via NestJS routes
- [ ] Migration guide created for external clients

## Estimated Effort

- **Analysis**: ✅ Complete (30 minutes)
- **Implementation**: 1.5 hours
- **Testing**: 30 minutes
- **Documentation**: 30 minutes
- **Total**: ~2.5 hours

## Next Steps

**Immediate**: 
1. Get approval for Option 1 (Deprecate Express Server)
2. Begin Phase 1 verification tasks

**Short-term**: 
1. Execute migration plan
2. Update all documentation
3. Validate with full test suite

**Long-term**:
1. Monitor for any issues
2. Remove deprecated files after 1 sprint
3. Close M4 issue

---

**Decision Required**: Approve Option 1 (Deprecate Express Server) and proceed with migration plan?
