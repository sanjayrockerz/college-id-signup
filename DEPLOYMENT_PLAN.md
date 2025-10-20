# Authentication Removal - Deployment Plan

## Overview

This document provides a comprehensive deployment strategy, rollback plan, and acceptance criteria for deploying the **no-auth public access model** to production.

**Status**: ✅ Ready for Deployment  
**Risk Level**: Medium (Schema changes, breaking API changes)  
**Rollback Strategy**: Prepared (branch + migration scripts)

---

## Pre-Deployment Validation

### ✅ Code Validation (COMPLETE)

All authentication artifacts have been removed:

- ✅ **No auth directories**: `src/auth/`, `src/**/guards/`, `src/**/strategies/`, `src/**/decorators/` - DELETED
- ✅ **No auth middleware files**: `src/middleware/auth.{js,ts}` - DELETED
- ✅ **No auth route files**: `src/routes/auth.{js,ts}` - DELETED
- ✅ **No JWT utilities**: `src/common/utils/jwt.*`, `src/config/jwt.*` - DELETED
- ✅ **No password utilities**: `src/utils/password.*` - DELETED
- ✅ **No auth patterns in code**: No `@UseGuards`, `PassportStrategy`, `jwt.sign/verify`, `bcrypt` calls
- ✅ **No auth dependencies**: `package.json` free of passport, jsonwebtoken, bcrypt, @nestjs/jwt, @nestjs/passport
- ✅ **No auth environment variables**: `.env.example` contains no JWT_SECRET, TOKEN_EXPIRY, etc.

### ✅ Database Validation (COMPLETE)

- ✅ **Schema clean**: `prisma/schema.prisma` has no auth fields (passwordHash, refreshToken, emailVerified, verificationToken)
- ✅ **Migration ready**: `prisma/migrations/remove_auth_fields.sql` prepared to drop `isVerified` column
- ✅ **No auth migrations**: No other pending auth-related migrations

### ✅ Documentation (COMPLETE)

- ✅ **API docs updated**: `API_DOCUMENTATION.md` includes Trust Model section
- ✅ **Middleware docs**: `src/middleware/README.md` focuses on rate limiting only
- ✅ **Config docs**: `src/config/README.md` has no DISABLE_AUTH references
- ✅ **Completion report**: `AUTH_REMOVAL_COMPLETE.md` documents all changes

### ✅ Build & Tests (COMPLETE)

- ✅ **TypeScript build**: `npm run build` succeeds
- ✅ **Jest config**: Coverage thresholds set (50-60%)
- ✅ **Integration tests**: Updated for public access model
- ✅ **No auth test artifacts**: All JWT/token test fixtures removed

---

## Deployment Strategy

### Phase 1: Pre-Production Staging (1-2 Days)

**Objective**: Validate the no-auth system in a production-like environment

#### Step 1.1: Deploy to Staging Environment

```bash
# 1. Backup staging database
pg_dump $STAGING_DATABASE_URL > backup_staging_$(date +%Y%m%d_%H%M%S).sql

# 2. Pull latest code
git checkout master
git pull origin master

# 3. Install dependencies
npm install
npm run prisma:generate

# 4. Build application
npm run build

# 5. Run database migration (removes isVerified column)
npx prisma migrate deploy

# 6. Start application
npm run start:prod
```

#### Step 1.2: Validate Staging Environment

Run through acceptance checklist (see below) on staging:

- [ ] Application boots successfully
- [ ] Health endpoints respond (GET /health, GET /health/database)
- [ ] Public endpoints work without auth headers
- [ ] Socket.IO connects and functions without auth
- [ ] Rate limiting enforces IP-based limits
- [ ] Logs show no auth-related errors
- [ ] Database schema reflects migration (no isVerified column)
- [ ] Frontend can connect and perform operations with userId parameters

#### Step 1.3: Load Testing

```bash
# Test rate limiting and endpoint performance
# Using tools like Apache Bench, k6, or Artillery

# Example with Apache Bench
ab -n 1000 -c 10 http://staging.api/health

# Test rate limit enforcement
ab -n 150 -c 1 http://staging.api/api/v1/posts
# Should receive 429 after 100 requests in 15 minutes
```

#### Step 1.4: Monitor Metrics

- **Error rate**: Should remain stable (<1% error rate)
- **Latency**: No significant increase (p95 < 200ms for simple endpoints)
- **Rate limit hits**: 429 responses should be logged and tracked
- **Database connections**: No auth-related query failures

---

### Phase 2: Production Deployment (Scheduled Maintenance Window)

**Recommended Time**: Off-peak hours (e.g., 2:00 AM - 4:00 AM local time)  
**Duration**: 30-60 minutes  
**Team**: Backend engineer + DevOps + on-call support

#### Step 2.1: Pre-Deployment Checklist

- [ ] Stakeholder approval obtained
- [ ] Deployment window scheduled and communicated
- [ ] Rollback branch prepared (see Rollback Plan below)
- [ ] Database backup completed and verified
- [ ] Monitoring dashboards ready
- [ ] Team on standby for deployment

#### Step 2.2: Database Backup

```bash
# Create timestamped backup
BACKUP_FILE="backup_prod_$(date +%Y%m%d_%H%M%S).sql"
pg_dump $DATABASE_URL > $BACKUP_FILE

# Verify backup integrity
psql $DATABASE_URL -c "SELECT COUNT(*) FROM users;" > pre_migration_counts.txt

# Upload backup to secure storage (S3, etc.)
aws s3 cp $BACKUP_FILE s3://your-backups-bucket/auth-removal-deployment/
```

#### Step 2.3: Deploy Application Code

```bash
# 1. Stop application gracefully
pm2 stop college-api
# OR if using systemd: systemctl stop college-api

# 2. Pull latest code
cd /var/www/college-api
git fetch origin
git checkout master
git pull origin master

# 3. Install dependencies
npm ci --production
npm run prisma:generate

# 4. Build application
npm run build

# 5. Run pre-deployment tests
npm run test
# Ensure all tests pass before proceeding
```

#### Step 2.4: Apply Database Migration

```bash
# Apply migration to remove isVerified column
npx prisma migrate deploy

# Verify migration applied
psql $DATABASE_URL -c "\d users" | grep isVerified
# Should return no results

# Compare record counts
psql $DATABASE_URL -c "SELECT COUNT(*) FROM users;" > post_migration_counts.txt
diff pre_migration_counts.txt post_migration_counts.txt
# Should show no difference (no data loss)
```

#### Step 2.5: Start Application

```bash
# Start application
pm2 start college-api
# OR: systemctl start college-api

# Check application logs
pm2 logs college-api --lines 100
# Look for startup success message and no auth errors

# Verify process is running
pm2 status
```

#### Step 2.6: Post-Deployment Validation (15 minutes)

```bash
# 1. Health check
curl https://api.yourapp.com/health
# Expected: {"status":"OK","timestamp":"...","uptime":...}

# 2. Database health
curl https://api.yourapp.com/health/database
# Expected: {"status":"OK","database":"connected"}

# 3. Test public endpoint
curl -X GET "https://api.yourapp.com/api/v1/posts?userId=test123"
# Expected: 200 OK with posts data

# 4. Test rate limiting
for i in {1..101}; do curl -s -o /dev/null -w "%{http_code}\n" https://api.yourapp.com/health; done
# Expected: First 100 return 200, 101st returns 429

# 5. Test Socket.IO connection (using websocat or similar)
websocat wss://api.yourapp.com/socket.io/?userId=test123
# Expected: Successful connection
```

#### Step 2.7: Monitor for 30 Minutes

Watch key metrics:

- **Application Logs**: No auth-related errors, no crashes
- **Error Rate**: Should remain stable (<1%)
- **Response Times**: p95 latency < 200ms
- **Database Queries**: No failed queries related to auth columns
- **Rate Limiting**: 429 responses logged correctly
- **User Reports**: No critical issues from frontend/users

---

### Phase 3: Post-Deployment Cleanup (24-48 Hours Later)

After confirming stable operation:

#### Step 3.1: Remove Auth Dependencies

```bash
# Check for unused auth packages (in chat-backend subdirectory)
cd chat-backend
npm uninstall bcryptjs jsonwebtoken

# Update root package.json if needed
cd ..
npm audit
npm update
```

#### Step 3.2: Clean Up Old Files

```bash
# Remove backup documentation files
rm src/middleware/README_OLD.md
rm API_DOCUMENTATION_OLD_BACKUP.md
rm API_DOCUMENTATION_BROKEN_BACKUP.md

# Remove migration script (already applied)
# Keep for historical record or move to archive
mkdir -p migrations_archive
mv prisma/migrations/remove_auth_fields.sql migrations_archive/
```

#### Step 3.3: Update Frontend

Coordinate with frontend team to:

- Remove token storage logic (localStorage, cookies)
- Remove Authorization headers from API calls
- Update API calls to pass `userId` in query params or body
- Remove login/register/logout UI flows
- Update error handling (no 401 responses)

---

## Rollback Plan

### Scenario 1: Issues Found in Staging

**Action**: Do NOT proceed to production. Fix issues first.

```bash
# Rollback staging database
psql $STAGING_DATABASE_URL < backup_staging_YYYYMMDD_HHMMSS.sql

# Revert code
git checkout rollback/auth-enabled
npm install
npm run build
npm run start:prod
```

### Scenario 2: Critical Issues in Production (Within 1 Hour)

**Triggers**:
- Error rate > 5%
- Application crashes repeatedly
- Database connection failures
- Critical functionality broken

**Action**: Immediate rollback

```bash
# 1. Stop application
pm2 stop college-api

# 2. Restore database from backup
psql $DATABASE_URL < backup_prod_YYYYMMDD_HHMMSS.sql

# 3. Verify data restoration
psql $DATABASE_URL -c "SELECT COUNT(*) FROM users;"
psql $DATABASE_URL -c "\d users" | grep isVerified
# Should show isVerified column exists

# 4. Revert to previous code version
git checkout rollback/auth-enabled
# OR: git revert HEAD~5..HEAD  # Revert last 5 commits

npm ci --production
npm run prisma:generate
npm run build

# 5. Start application
pm2 start college-api

# 6. Validate rollback
curl https://api.yourapp.com/health
# Should return 200 OK
```

### Scenario 3: Issues Found After 24+ Hours

**Action**: Forward-only fix (no database rollback)

If database rollback is too risky (new data created):

1. **Hotfix Branch**: Create fix for specific issue
2. **Database Migration**: Write forward-only migration if needed
3. **Deploy Fix**: Follow expedited deployment process
4. **Keep Monitoring**: Extended observation period

---

## Acceptance Checklist

### Code Acceptance Criteria

- [ ] No authentication imports exist in codebase
  ```bash
  grep -r "passport\|jsonwebtoken\|bcrypt\|argon2\|@nestjs/jwt\|@nestjs/passport" src/ --exclude-dir=node_modules
  # Expected: No matches
  ```

- [ ] No auth routes exist
  ```bash
  ls src/routes/ | grep -i auth
  # Expected: No results
  ```

- [ ] No auth middleware exists
  ```bash
  ls src/middleware/ | grep -i auth
  # Expected: No results
  ```

- [ ] No DISABLE_AUTH references in code
  ```bash
  grep -r "DISABLE_AUTH" src/
  # Expected: No matches
  ```

- [ ] TypeScript build succeeds
  ```bash
  npm run build
  # Expected: Exit code 0, no errors
  ```

### API Acceptance Criteria

- [ ] API documentation updated with Trust Model section
  ```bash
  grep -A 10 "## Trust Model" API_DOCUMENTATION.md
  # Expected: Trust Model section found with 6 subsections
  ```

- [ ] Health endpoints respond
  ```bash
  curl http://localhost:3001/health
  curl http://localhost:3001/health/database
  # Expected: 200 OK responses
  ```

- [ ] Public endpoints work without auth
  ```bash
  curl -X GET "http://localhost:3001/api/v1/posts?userId=test"
  # Expected: 200 OK with data (no 401/403)
  ```

- [ ] Rate limiting enforced
  ```bash
  # Make 101 requests rapidly
  for i in {1..101}; do curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/health; done | tail -1
  # Expected: 429 (rate limit exceeded)
  ```

### Database Acceptance Criteria

- [ ] Schema has no auth fields
  ```bash
  grep -i "password\|token\|verified\|session" prisma/schema.prisma
  # Expected: No auth-related fields in User model
  ```

- [ ] Migration applied successfully (production only)
  ```bash
  psql $DATABASE_URL -c "\d users" | grep isVerified
  # Expected: No results (column removed)
  ```

- [ ] No data loss during migration
  ```bash
  # Compare pre/post user counts
  diff pre_migration_counts.txt post_migration_counts.txt
  # Expected: No difference
  ```

### Socket.IO Acceptance Criteria

- [ ] Socket connects without auth
  ```bash
  # Use Socket.IO client tool or websocat
  node -e "const io = require('socket.io-client'); const socket = io('http://localhost:3001', {query: {userId: 'test'}}); socket.on('connect', () => {console.log('Connected!'); process.exit(0)});"
  # Expected: "Connected!" logged
  ```

- [ ] Socket events work with userId in payload
  ```bash
  # Test send_message event (requires test script)
  # Expected: Message sent successfully without auth token
  ```

### Testing Acceptance Criteria

- [ ] All tests pass
  ```bash
  npm run test
  # Expected: 0 failed tests
  ```

- [ ] Coverage thresholds met
  ```bash
  npm run test:cov
  # Expected: Branches ≥50%, Functions ≥50%, Lines ≥60%, Statements ≥60%
  ```

- [ ] Integration tests reflect public access
  ```bash
  node test/chat-backend-verification.js
  # Expected: 3/5 tests pass (2 require database)
  ```

### Environment Acceptance Criteria

- [ ] No auth environment variables in `.env.example`
  ```bash
  grep -i "jwt\|token\|secret" .env.example
  # Expected: No results
  ```

- [ ] Dependencies contain no auth packages
  ```bash
  grep -E "passport|jsonwebtoken|bcrypt|argon2|@nestjs/jwt|@nestjs/passport" package.json
  # Expected: No matches in main package.json
  ```

### Monitoring Acceptance Criteria

- [ ] Application starts without errors
  ```bash
  pm2 logs college-api --lines 20 | grep -i error
  # Expected: No authentication-related errors
  ```

- [ ] Error rate stable (<1%)
  - Monitor application logs
  - Check error tracking service (Sentry, etc.)

- [ ] Response times acceptable (p95 < 200ms)
  - Monitor APM dashboard
  - Check rate limit response times

- [ ] No 401/403 errors logged
  ```bash
  pm2 logs college-api --lines 1000 | grep -E "401|403"
  # Expected: No results (all endpoints public)
  ```

---

## Stakeholder Sign-Off

### Technical Sign-Off

- [ ] **Backend Engineer**: Code reviewed, tests passing, documentation complete
- [ ] **DevOps Engineer**: Deployment plan reviewed, rollback tested
- [ ] **Database Administrator**: Migration reviewed, backup strategy confirmed
- [ ] **QA Engineer**: Staging validation complete, acceptance criteria met

### Business Sign-Off

- [ ] **Product Manager**: Understands security implications, approves public access model
- [ ] **Security Lead**: Risk assessed, monitoring requirements defined
- [ ] **Engineering Manager**: Deployment window approved, team resources allocated

**Sign-Off Date**: _________________________

**Deployment Scheduled For**: _________________________

---

## Post-Deployment Monitoring (First 7 Days)

### Daily Checks

- [ ] **Day 1**: Hourly monitoring for first 8 hours, then every 4 hours
- [ ] **Day 2-3**: Check every 12 hours
- [ ] **Day 4-7**: Daily check

### Metrics to Monitor

1. **Error Rate**: Should remain <1%
2. **API Response Times**: p95 latency should not increase >20%
3. **Rate Limit Violations**: Track 429 responses (should be <5% of requests)
4. **Database Performance**: No auth-related query errors
5. **User Reports**: Monitor support tickets for API-related issues

### Alert Thresholds

- **Critical**: Error rate >5%, application down >5 minutes
- **Warning**: Error rate 2-5%, response time p95 >500ms
- **Info**: Rate limit violations >10% of requests

---

## Conclusion

This deployment plan provides a safe, staged approach to deploying the no-auth public access model. The rollback strategy ensures quick recovery if issues arise, and the acceptance checklist ensures all stakeholders agree the system is ready.

**Key Success Factors**:
1. Comprehensive pre-deployment validation (staging environment)
2. Database backup before migration
3. Gradual rollout with monitoring
4. Clear rollback procedures
5. Stakeholder sign-off before production deployment

**Next Steps**:
1. Schedule deployment window with stakeholders
2. Complete staging validation (Phase 1)
3. Obtain sign-offs from all required parties
4. Execute production deployment (Phase 2)
5. Monitor for 7 days post-deployment

---

**Document Version**: 1.0  
**Last Updated**: October 20, 2025  
**Prepared By**: Backend Engineering Team  
**Review Status**: ✅ Ready for Stakeholder Review
