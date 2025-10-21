# Iteration Plan: Scope Enforcement & Quality Hardening
## 6 Sprints - 3-5 Days Each

**Generated**: 2025-10-20T21:00:00Z  
**Repository**: college-id-signup-1  
**Total Duration**: 24-30 days  
**Total Backlog Items**: 80

---

## ITERATION 1: Module Eradication (5 days)
### Scope: Remove out-of-scope modules from codebase

**Objective**: Delete 6 feature modules (idcard, feed, posts, connections, interactions, upload) and frontend directory

**Backlog Items** (31 items):
- BLOCKER-001: Remove src/idcard/ module (17 files)
- BLOCKER-002: Remove src/feed/ module (5 files)
- BLOCKER-003: Remove src/posts/ module (7 files)
- BLOCKER-004: Remove src/connections/ module (5 files)
- BLOCKER-005: Remove src/interactions/ module (5 files)
- BLOCKER-006: Remove src/upload/ module (3 files)
- BLOCKER-014: Delete frontend/ directory (6 files)
- BLOCKER-017 to BLOCKER-021: Remove 27 API endpoints
- BLOCKER-022: Clean startup messages
- BLOCKER-023: Delete ID_CARD_VERIFICATION.md
- BLOCKER-024: Delete AUTHENTICATION_COMPLETE.md
- BLOCKER-025: Remove AWS S3 env vars
- MAJOR-014: Remove FRONTEND_URL/CLIENT_URL env vars
- MAJOR-015: Remove mobile optimization service
- MAJOR-016: Clean validation middleware
- MAJOR-017: Remove author tracking from mocks
- MAJOR-018: Delete 8 legacy JavaScript files
- MAJOR-019: Remove chat-backend/ duplicate directory
- MINOR-003: Remove authorization header from CORS
- MINOR-004: Remove commented @UseGuards
- MINOR-006: Remove MOBILE_OPTIMIZATION_REPORT.md
- MINOR-007: Remove UPLOAD_ROUTER_STATUS.md
- MINOR-009: Remove legacy Express routes
- MINOR-016 to MINOR-018: Remove legacy files
- DEBT-001: Consolidate duplicate chat implementations
- DEBT-002: Remove ML anomaly detection service
- DEBT-003: Remove device fingerprinting service
- DEBT-005: Remove view tracking service

**Execution Order**:
1. Remove module imports from app.module.ts (all 6 modules)
2. Delete src/idcard/ (breaks upload dependency)
3. Delete src/upload/ (no longer needed)
4. Delete src/feed/ → src/posts/ → src/connections/ → src/interactions/
5. Delete frontend/ directory
6. Clean environment variables (.env.example)
7. Remove documentation files
8. Delete legacy JavaScript files
9. Clean up chat-backend/ duplicate
10. Remove unused services from common/

**Blast Radius**:
- Files deleted: ~50
- Lines of code removed: ~12,000
- Modules affected: app.module.ts, main.ts
- API endpoints removed: 27
- Dependencies removed: 8 npm packages (react, vite, AWS SDK, etc.)

**Risk Level**: MEDIUM
- **Risks**:
  - Breaking changes for external clients using removed endpoints
  - Potential TypeScript compilation errors if cross-module references missed
  - Server may fail to boot if import cleanup incomplete
- **Mitigation**:
  - Remove imports first, then delete directories (prevents import errors)
  - Test build after each module removal
  - Commit atomically (one module per commit for easy rollback)

**Rollback Procedure**:
```bash
# If TypeScript errors:
git revert <commit> && npm run build

# If server fails to boot:
git revert HEAD~5..HEAD  # Revert last 5 commits
npm install && npm run build
```

**Quality Gates** (ALL MUST PASS):
- ✅ Zero TypeScript errors (`npm run build`)
- ✅ Zero ESLint errors (`npm run lint`)
- ✅ Server boots successfully (`npm run start:dev`, wait 10s)
- ✅ Health endpoint responds (`curl http://localhost:3001/health`)
- ✅ Zero imports from deleted modules (`grep -r "from.*idcard\|feed\|posts\|connections\|interactions\|upload" src/`)
- ✅ All acceptance tests pass (BLOCKER-001 to BLOCKER-025)

**Exit Criteria**:
- [ ] All 31 backlog items marked DONE
- [ ] Build time ≤ 2 seconds (baseline: 1.26s)
- [ ] Zero references to deleted modules in codebase
- [ ] Documentation updated (README.md, API_DOCUMENTATION.md)
- [ ] PR evidence pack complete (commit log, test results, rollback notes)

---

## ITERATION 2: Schema Purge (3 days)
### Scope: Remove college-domain fields and models from database schema

**Objective**: Drop 7 schema changes (3 User fields, 4 social models) via Prisma migrations

**Backlog Items** (14 items):
- BLOCKER-007: Drop User.verifiedCollegeId
- BLOCKER-008: Drop User.collegeName
- BLOCKER-009: Drop User.studentIdNumber
- BLOCKER-010: Drop Post model
- BLOCKER-011: Drop Connection model
- BLOCKER-012: Drop Interaction model
- BLOCKER-013: Drop Feed model
- BLOCKER-015: Rename package.json metadata
- BLOCKER-016: Rename database from college_chat_db
- MAJOR-001: Refactor User module - remove college endpoints
- MAJOR-020: Update seed scripts
- MINOR-008: Clean Docker Compose database name
- TEST-003: Add migration rollback tests

**Execution Order**:
1. **Backup database** (`pg_dump`)
2. Create Prisma migration dropping 4 models (Post, Connection, Interaction, Feed)
3. Create Prisma migration dropping 3 User fields
4. Test migrations on dev environment
5. Test migrations on sanitized production snapshot
6. Apply migrations to production (low-traffic window)
7. Verify Message/Conversation data intact
8. Refactor User module (remove college endpoints)
9. Update seed scripts
10. Rename database in configs
11. Update package.json metadata

**Blast Radius**:
- Schema changes: 7 (4 models dropped, 3 fields dropped)
- Files modified: ~15
- Lines of code changed: ~300
- Downtime estimate: 3 minutes (ALTER TABLE operations)

**Risk Level**: HIGH
- **Risks**:
  - **DATA LOSS**: Irreversible deletion of college verification data
  - Migration failure could corrupt database
  - Downtime during ALTER TABLE operations
  - External clients expecting removed fields will break
- **Mitigation**:
  - **CRITICAL**: Backup database before migration
  - Test on production snapshot in staging environment
  - Apply during low-traffic window (e.g., 2 AM UTC)
  - Monitor error rates for 1 hour post-deployment
  - Keep backup for 30 days

**Rollback Procedure**:
```bash
# Database rollback (DESTRUCTIVE - loses data since migration):
pg_restore -U postgres -d college_chat_db < backup_20251020.sql
# Estimated downtime: 5 minutes

# Code rollback:
git revert <migration-commit> && npm run build && deploy
# Estimated downtime: 2 minutes
```

**Quality Gates** (ALL MUST PASS):
- ✅ Database backup created and verified (size > 0)
- ✅ Prisma schema validates (`npx prisma validate`)
- ✅ Migration applies cleanly on dev (`npx prisma migrate deploy`)
- ✅ Migration applies cleanly on staging with production snapshot
- ✅ Message model intact (count matches pre-migration)
- ✅ Conversation model intact (count matches pre-migration)
- ✅ Zero references to removed fields in code
- ✅ TypeScript compilation passes
- ✅ Server boots and health check passes
- ✅ All acceptance tests pass (BLOCKER-007 to BLOCKER-016)

**Exit Criteria**:
- [ ] All 14 backlog items marked DONE
- [ ] Schema validation passes
- [ ] Zero data loss for Message/Conversation models
- [ ] Error rate ≤ baseline + 0.1% (1 hour monitoring)
- [ ] Database backup archived to cold storage
- [ ] Migration guide published for external clients

---

## ITERATION 3: Documentation & Configuration Cleanup (3 days)
### Scope: Update documentation, clean environment variables, fix branding

**Objective**: Align documentation with actual implementation, remove stale configs

**Backlog Items** (12 items):
- MAJOR-005: Remove college references from README.md
- MAJOR-006: Remove college references from API_DOCUMENTATION.md
- MAJOR-007: Consolidate CORS env vars
- MAJOR-012: Document 12 undocumented chat endpoints
- MAJOR-013: Document 9 Socket.IO events
- MINOR-001: Add DB_* env vars to .env.example
- MINOR-002: Change PRISMA_CLIENT_MODE default
- MINOR-005: Clean governance docs
- MINOR-019: Archive discovery/triage docs
- MINOR-020: Create production runbook
- DOC-001: Create OpenAPI spec
- DOC-002: Document Socket.IO contracts
- DOC-003: Update CHANGELOG.md
- DOC-004: Create migration guide

**Execution Order**:
1. Update README.md (remove college features, focus on chat)
2. Update API_DOCUMENTATION.md (remove 27 endpoints, document 12 missing)
3. Create OpenAPI 3.0 spec for REST endpoints
4. Document Socket.IO event contracts
5. Consolidate env vars in .env.example
6. Update governance docs (remove college references)
7. Create production runbook (deployment, monitoring, rollback)
8. Create migration guide for breaking changes
9. Update CHANGELOG.md
10. Archive discovery/triage docs to history/

**Blast Radius**:
- Documentation files: ~15 modified
- Lines changed: ~2,000
- Config files: 2 (.env.example, docker-compose.yml)

**Risk Level**: LOW
- **Risks**: Documentation drift if not reviewed
- **Mitigation**: Cross-reference docs with actual code, validate API spec with server

**Rollback Procedure**:
```bash
# Revert documentation changes if incorrect:
git revert <doc-commit> && git push
# No downtime
```

**Quality Gates**:
- ✅ README.md has zero college references (`! grep -i "college" README.md`)
- ✅ API_DOCUMENTATION.md matches OpenAPI spec
- ✅ All 12 chat endpoints documented
- ✅ All 9 Socket.IO events documented
- ✅ .env.example has all required variables with descriptions
- ✅ Production runbook covers deployment, monitoring, rollback
- ✅ Migration guide lists all breaking changes
- ✅ All acceptance tests pass (MAJOR-005 to DOC-004)

**Exit Criteria**:
- [ ] All 12 backlog items marked DONE
- [ ] Documentation consistency check passes (doc-code-delta-table.csv has 0 deltas)
- [ ] OpenAPI spec validates against actual endpoints
- [ ] Runbook reviewed by ops team
- [ ] Migration guide reviewed by stakeholders

---

## ITERATION 4: Security Hardening (4 days)
### Scope: Fix vulnerabilities, add security controls, enable validation

**Objective**: Address 9 npm vulnerabilities, add Helmet, enforce rate limiting and input validation

**Backlog Items** (11 items):
- MAJOR-002: Fix 2 high severity vulnerabilities
- MAJOR-003: Fix 7 moderate vulnerabilities
- MAJOR-009: Add Helmet for security headers
- MAJOR-010: Validate rate limiting enforced
- MAJOR-011: Validate input validation enforced
- SEC-001: Verify Prisma SQL injection protection
- SEC-002: Add XSS response sanitization
- SEC-003: Configure Socket.IO max payload (1 MB)
- SEC-004: Configure Socket.IO connection limits (1000)
- SEC-005: Add message content size validation (10 KB)
- SEC-006: Set up Snyk in CI/CD

**Execution Order**:
1. Run `npm audit fix` for moderate vulnerabilities
2. Manually review and fix 2 high severity issues
3. Install and configure Helmet middleware
4. Add Socket.IO payload size limits
5. Add Socket.IO connection limits
6. Add message content size validation
7. Enable rate limiting integration tests
8. Enable input validation integration tests
9. Add XSS sanitization tests
10. Configure Snyk in GitHub Actions
11. Verify all security controls active

**Blast Radius**:
- Dependencies updated: ~15
- Files modified: ~10
- New middleware: 3 (Helmet, payload limiter, connection limiter)
- Tests added: ~20

**Risk Level**: MEDIUM
- **Risks**:
  - Dependency updates may introduce breaking changes
  - New validation may break existing clients
  - Rate limiting may block legitimate traffic
- **Mitigation**:
  - Test dependency updates in staging first
  - Use feature flags to enable validation gradually
  - Set generous rate limits initially (100 req/min)

**Rollback Procedure**:
```bash
# If dependency update breaks:
npm install <package>@<old-version> && npm run build

# If validation breaks clients:
# Disable via feature flag in .env
ENABLE_STRICT_VALIDATION=false
```

**Quality Gates**:
- ✅ Zero high/critical npm vulnerabilities (`npm audit`)
- ✅ Helmet headers present (`curl -I http://localhost:3001 | grep X-Content-Type-Options`)
- ✅ Rate limiting enforced (101st request in 1 min returns 429)
- ✅ Input validation rejects malformed payloads (400 Bad Request)
- ✅ Socket.IO rejects oversized payloads (>1 MB returns error)
- ✅ Socket.IO enforces connection limit (1001st connection rejected)
- ✅ Message content >10 KB rejected
- ✅ Snyk scan passes in CI/CD
- ✅ All acceptance tests pass (MAJOR-002, MAJOR-009, SEC-001 to SEC-006)

**Exit Criteria**:
- [ ] All 11 backlog items marked DONE
- [ ] Security baseline improved (0 high/critical vulns)
- [ ] All security controls validated in integration tests
- [ ] Snyk reporting active in CI/CD
- [ ] Security documentation updated

---

## ITERATION 5: Testing & Performance (5 days)
### Scope: Enable skipped tests, achieve 75% coverage, optimize queries

**Objective**: Enable 44 integration tests, add performance tests, optimize database queries

**Backlog Items** (14 items):
- MAJOR-004: Enable 44 skipped integration tests
- MINOR-010: Add conversationId+createdAt index
- MINOR-011: Add conversationId+userId+isRead index
- MINOR-012: Optimize N+1 in getConversations
- MINOR-013: Optimize N+1 in getMessages
- PERF-001: Set p95 latency SLO (250ms)
- PERF-002: Benchmark concurrent connections (100 clients)
- PERF-003: Benchmark message throughput (1000 msg/sec)
- PERF-004: Add slow query logging
- TEST-001: Achieve 75% coverage
- TEST-002: Add smoke test battery
- TEST-003: Add migration rollback tests
- TEST-004: Add concurrent user load tests (50 RPS)

**Execution Order**:
1. Set up test database (Docker Compose PostgreSQL)
2. Configure DATABASE_URL for test environment
3. Enable Socket.IO integration tests (socket-api.integration.spec.ts)
4. Enable REST API integration tests (chat-api.integration.spec.ts)
5. Fix failing tests one by one
6. Add composite indexes to Message model
7. Optimize N+1 queries with Prisma include
8. Add smoke test battery (REST + Socket.IO)
9. Add performance benchmarks (latency, throughput, concurrency)
10. Add migration rollback tests
11. Measure coverage, add tests to reach 75%

**Blast Radius**:
- Tests enabled: 44
- New tests added: ~30
- Schema changes: 2 indexes
- Files modified: ~25

**Risk Level**: LOW
- **Risks**:
  - Tests may reveal hidden bugs
  - Index additions require migration (brief downtime)
  - Performance tests may overload dev database
- **Mitigation**:
  - Fix bugs before deploying
  - Apply index migrations during low-traffic window
  - Run performance tests against dedicated test database

**Rollback Procedure**:
```bash
# If tests block deployment:
# Skip tests temporarily (not recommended)
npm test -- --testPathIgnorePatterns="integration"

# If index migration fails:
npx prisma migrate resolve --rolled-back <migration-name>
```

**Quality Gates**:
- ✅ All 44 integration tests passing
- ✅ Code coverage ≥75% (`npm test -- --coverage`)
- ✅ p95 latency ≤250ms @ 50 RPS
- ✅ Concurrent connection test passes (100 clients)
- ✅ Message throughput ≥500 msg/sec
- ✅ EXPLAIN ANALYZE shows index usage (not Seq Scan)
- ✅ Smoke test battery passes (REST + Socket.IO)
- ✅ Migration rollback tests pass
- ✅ All acceptance tests pass (MAJOR-004, MINOR-010 to PERF-004, TEST-001 to TEST-004)

**Exit Criteria**:
- [ ] All 14 backlog items marked DONE
- [ ] Test suite healthy (all passing, >75% coverage)
- [ ] Performance SLOs met (p95 ≤250ms)
- [ ] Database indexes optimized
- [ ] Performance baseline documented

---

## ITERATION 6: Observability & Final Polish (4 days)
### Scope: Add logging, metrics, monitoring, finalize documentation

**Objective**: Production-ready observability, structured logging, Prometheus metrics

**Backlog Items** (8 items):
- MINOR-014: Add structured logging with correlation IDs
- MINOR-015: Add Prometheus metrics
- DEBT-004: Verify GDPR compliance service
- All remaining MINOR items (cleanup tasks)

**Execution Order**:
1. Add structured JSON logging (winston or pino)
2. Add correlation ID middleware (requestId)
3. Add Prometheus metrics endpoint (/metrics)
4. Add custom metrics (message_sent_total, conversation_created_total)
5. Configure Grafana dashboards
6. Set up alerting (error rate, latency, throughput)
7. Verify GDPR compliance utilities
8. Final documentation review
9. Final code cleanup

**Blast Radius**:
- Files modified: ~20
- New dependencies: 3 (prom-client, winston/pino, uuid)
- Endpoints added: 1 (/metrics)

**Risk Level**: LOW
- **Risks**: Logging overhead may impact performance
- **Mitigation**: Use async logging, sample high-volume logs

**Rollback Procedure**:
```bash
# If logging impacts performance:
# Disable via feature flag
ENABLE_STRUCTURED_LOGGING=false
```

**Quality Gates**:
- ✅ Logs are JSON-formatted with requestId
- ✅ Prometheus metrics scraped successfully
- ✅ Grafana dashboards display metrics
- ✅ Alerts configured for error rate, latency
- ✅ GDPR compliance verified (data retention, right to deletion)
- ✅ All acceptance tests pass

**Exit Criteria**:
- [ ] All 8 backlog items marked DONE
- [ ] Observability stack operational (logs, metrics, alerts)
- [ ] Production runbook complete
- [ ] Final stakeholder sign-off

---

## Global Quality Gates (Apply to ALL Iterations)

Every iteration MUST pass these gates before proceeding:

### Build & Compilation
- ✅ `npm run build` exits with code 0
- ✅ Build time ≤ 2 seconds (baseline: 1.26s, tolerance: +50%)
- ✅ Zero TypeScript errors (strict mode)

### Code Quality
- ✅ `npm run lint` exits with code 0
- ✅ Zero ESLint errors
- ✅ Zero ESLint warnings (after Iteration 1)

### Testing
- ✅ All unit tests pass (`npm test`)
- ✅ All integration tests pass (after Iteration 5)
- ✅ Code coverage ≥75% (after Iteration 5)
- ✅ Smoke battery passes (after Iteration 5)

### Runtime Stability
- ✅ Server boots successfully in ≤10 seconds
- ✅ Health endpoint responds 200 (`GET /health`)
- ✅ Database health check passes (`GET /health/database`)
- ✅ Socket.IO server accepts connections

### Performance
- ✅ p95 latency ≤250ms @ 50 RPS (after Iteration 5)
- ✅ Error rate ≤ baseline + 0.1% (monitored for 1 hour)
- ✅ Memory usage stable (no leaks over 6 hours)

### Security
- ✅ Zero HIGH/CRITICAL npm vulnerabilities (after Iteration 4)
- ✅ Security headers present (after Iteration 4)
- ✅ Rate limiting enforced (after Iteration 4)
- ✅ Input validation active (after Iteration 4)

### Documentation
- ✅ README.md updated
- ✅ API_DOCUMENTATION.md updated (after Iteration 3)
- ✅ CHANGELOG.md updated
- ✅ .env.example matches actual usage

### Evidence & Governance
- ✅ All acceptance tests pass for iteration
- ✅ PR description includes:
  - Backlog items completed
  - Test results screenshot
  - Performance metrics
  - Rollback procedure
  - Breaking changes (if any)
- ✅ Code review approved by 1+ reviewers
- ✅ CI/CD pipeline green

---

## Iteration Dependencies

```
ITERATION 1 (Module Eradication)
  ↓
ITERATION 2 (Schema Purge) - DEPENDS ON: ITERATION 1 (modules deleted)
  ↓
ITERATION 3 (Documentation Cleanup) - DEPENDS ON: ITERATION 1-2 (scope finalized)
  ↓
ITERATION 4 (Security Hardening) - INDEPENDENT (can parallelize with 3)
  ↓
ITERATION 5 (Testing & Performance) - DEPENDS ON: ITERATION 1-4 (stable codebase)
  ↓
ITERATION 6 (Observability & Polish) - DEPENDS ON: ITERATION 5 (tests passing)
```

---

## Timeline

| Iteration | Duration | Dates (example) | Backlog Items | Risk | Dependencies |
|-----------|----------|-----------------|---------------|------|--------------|
| 1 - Module Eradication | 5 days | Oct 21-25 | 31 | MEDIUM | None |
| 2 - Schema Purge | 3 days | Oct 28-30 | 14 | HIGH | Iteration 1 |
| 3 - Documentation Cleanup | 3 days | Oct 31-Nov 2 | 12 | LOW | Iterations 1-2 |
| 4 - Security Hardening | 4 days | Nov 3-6 | 11 | MEDIUM | None (can parallelize) |
| 5 - Testing & Performance | 5 days | Nov 7-13 | 14 | LOW | Iterations 1-4 |
| 6 - Observability & Polish | 4 days | Nov 14-17 | 8 | LOW | Iteration 5 |

**Total Duration**: 24 days (excluding weekends: ~30 calendar days)

---

## Rollback Safety Net

Every iteration has a defined rollback procedure:

### Code Rollback
```bash
# Single commit:
git revert <commit-sha> && git push && deploy

# Multiple commits:
git revert <start-sha>..<end-sha> && git push && deploy
```

### Database Rollback
```bash
# Restore from backup (DESTRUCTIVE):
pg_restore -U postgres -d college_chat_db < backup_YYYYMMDD.sql

# Or revert migration:
npx prisma migrate resolve --rolled-back <migration-name>
```

### Environment Rollback
```bash
# Restore .env from version control:
cp .env.backup .env && redeploy
```

**Critical**: Always backup database before schema changes (Iteration 2)

---

## Stakeholder Sign-Off

**Approval Required Before Proceeding**:

- [ ] **Product Owner**: Confirms scope removals align with product vision
- [ ] **Engineering Lead**: Approves technical approach and iteration sequence
- [ ] **Operations**: Confirms rollback procedures and monitoring plan
- [ ] **Security**: Approves security hardening approach (Iteration 4)
- [ ] **QA**: Confirms testing strategy and coverage targets (Iteration 5)

**Signatures**:
- Product Owner: __________________ Date: __________
- Engineering Lead: __________________ Date: __________
- Operations: __________________ Date: __________
- Security: __________________ Date: __________
- QA: __________________ Date: __________

---

**END OF ITERATION PLAN**
