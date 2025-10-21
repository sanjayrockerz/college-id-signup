# Deprecated Express Server Files

**Date Deprecated**: 2025-10-20  
**Reason**: Consolidated to NestJS-only architecture  
**Migration**: See `docs/migration/EXPRESS_TO_NESTJS.md`

## Files in This Directory

These files were part of the legacy standalone Express server that ran on port 3000. All functionality has been migrated to the NestJS application (`src/main.ts`) which now serves all routes via `/api/v1/*`.

### Deprecated Files

- **app.ts.old** - Legacy Express application with ID card routes
- **app.js.old** - JavaScript version of Express app
- **server.ts.old** - HTTP server wrapper for Express app
- **server.js.old** - JavaScript version of server wrapper
- **simple-server.js.old** - Minimal Express server for quick testing

### Migration Summary

| Old Route (Express) | New Route (NestJS) | Status |
|---------------------|-------------------|--------|
| `/health` | `/api/v1/health` | ✅ Migrated |
| `/health/database` | `/api/v1/health/database` | ✅ Migrated |
| `POST /api/id-card/upload` | `POST /api/v1/idcard/upload` | ✅ Migrated & Enhanced |
| `POST /api/id-card/verify` | `POST /api/v1/idcard/verify` | ✅ Migrated |
| `GET /api/id-card/history` | `GET /api/v1/idcard/history` | ✅ Migrated |
| `GET /api/id-card/status` | `GET /api/v1/idcard/verification/:id` | ✅ Migrated (renamed) |
| `PUT /api/id-card/resubmit` | **Not migrated** | ⚠️ Feature deprecated |
| `GET /api/id-card/admin/pending` | **Not migrated** | ⚠️ Admin features moved to admin portal |
| `PUT /api/id-card/admin/review/:id` | **Not migrated** | ⚠️ Admin features moved to admin portal |

### Why NestJS?

The NestJS implementation provides:
- **Dependency Injection**: Cleaner service architecture
- **Type Safety**: Full TypeScript integration with decorators
- **Testing**: Built-in testing utilities and mocking
- **Modularity**: Clear separation of concerns with modules
- **Validation**: Class-validator integration for request DTOs
- **Documentation**: Automatic API documentation generation
- **Middleware**: Better middleware composition
- **WebSockets**: Native Socket.IO integration

### Rollback Procedure (Emergency Only)

If you need to rollback to the Express server:

1. Restore files from this directory:
   ```bash
   cp src/deprecated/app.ts.old src/app.ts
   cp src/deprecated/server.js.old src/server.js
   ```

2. Update package.json start script:
   ```json
   "start": "node src/server.js"
   ```

3. Restart the application:
   ```bash
   npm start
   ```

**Note**: This should only be done in emergency situations. Contact the development team first.

### Removal Timeline

These files will be permanently deleted after:
- **Date**: 2025-11-20 (30 days from deprecation)
- **Condition**: No rollbacks required for 30 consecutive days
- **Process**: Create PR to remove `src/deprecated/` directory

### Questions?

See the migration guide: `docs/migration/EXPRESS_TO_NESTJS.md`

Or contact the development team.
