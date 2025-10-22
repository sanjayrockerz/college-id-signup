# Change Control Policy

**Version**: 1.0  
**Effective Date**: 2025-10-20  
**Authority**: Engineering Leadership + Product  
**Compliance**: SOC 2, ISO 27001 compatible

---

## Purpose

This document establishes **formal change control procedures** for the chat backend to ensure:
- Production stability and zero-downtime deployments
- Clear approval authorities for different types of changes
- Rollback procedures for failed deployments
- Audit trail for compliance and post-mortem analysis

---

## Change Categories

### Category 1: Low-Risk Changes (Auto-Approved)

**Definition**: Changes with minimal production impact and automatic rollback capability

**Examples**:
- Documentation updates (README, runbooks, comments)
- Log level adjustments (debug → info)
- Configuration changes via feature flags (no code deploy)
- Bug fixes with comprehensive test coverage (>90% coverage for changed code)
- Dependency patch updates (security fixes)

**Approval Process**:
- ✅ **Automated**: CI/CD pipeline validates (tests pass, no lint errors) → auto-deploy to staging → auto-deploy to production after 2-hour soak
- **Notification**: Slack #deployments channel (informational only)
- **Rollback**: Automated if error rate >0.5% or p95 latency >250ms

**Change Window**: 24/7 (no restrictions)

---

### Category 2: Medium-Risk Changes (Single Approval)

**Definition**: Changes affecting API surface, database schema (backward-compatible), or infrastructure

**Examples**:
- New REST endpoints or Socket.IO events
- Database schema additions (new tables, columns, indexes) without dropping existing data
- Dependency minor version upgrades (e.g., `express` 5.0.0 → 5.1.0)
- Environment variable additions (no removals)
- Infrastructure scaling (CPU/memory limits, replica count)

**Approval Process**:
1. **Author**: Submit PR with change description, test evidence, rollback plan
2. **Reviewer**: Backend Lead (or designated senior engineer) reviews within 1 business day
3. **Deployment**:
   - Staging deployment → automated smoke tests pass → manual QA approval
   - Production deployment during change window (see below)
4. **Notification**: Slack #deployments + email to stakeholders
5. **Monitoring**: Watch dashboards for 1 hour post-deployment

**Rollback Authority**: Backend Lead can trigger rollback without approval

**Change Windows**:
- **Preferred**: Tuesday-Thursday, 10:00-16:00 UTC (low traffic periods)
- **Restricted**: Friday 16:00 - Monday 08:00 (weekend freeze)
- **Emergency exceptions**: Backend Lead + SRE Lead approval required

---

### Category 3: High-Risk Changes (Multi-Approval)

**Definition**: Breaking changes, migrations requiring downtime, or major architectural shifts

**Examples**:
- Breaking API changes (removing endpoints, changing response schemas)
- Database migrations dropping columns/tables or requiring application downtime
- Dependency major version upgrades (e.g., NestJS 10 → 11, Prisma 4 → 5)
- Protocol changes (Socket.IO v4 → v5, HTTP/1.1 → HTTP/2)
- Infrastructure migrations (PostgreSQL 14 → 15, Node.js 18 → 20)

**Approval Process**:
1. **RFC (Request for Comments)**: Author publishes design doc 5+ business days before change
   - Include: motivation, design, alternatives considered, rollback plan, testing strategy
2. **Review Meeting**: Tech Architect + Backend Lead + DBA Lead + SRE Lead + Product Owner
   - Decision documented in meeting notes with explicit sign-offs
3. **Stakeholder Communication**: Email to all teams 3+ business days before deployment
4. **Deployment Plan**:
   - Staging validation with full regression suite
   - Production deployment during **planned maintenance window** (requires customer notification)
   - Feature flag gradual rollout: 5% → 25% → 50% → 100% over 48 hours
5. **Post-Deployment**:
   - Incident Commander on standby for 4 hours
   - Daily status updates for 3 days post-deployment

**Rollback Authority**: Requires Backend Lead + SRE Lead approval (or Incident Commander during active incident)

**Change Windows**:
- **Planned Maintenance**: First Tuesday of month, 02:00-06:00 UTC (announced 2 weeks in advance)
- **Emergency**: CTO approval required

---

### Category 4: Emergency Changes (Expedited)

**Definition**: Critical production incidents requiring immediate remediation

**Examples**:
- CRITICAL security vulnerability patches (CVE with CVSS >9.0)
- Production outage hotfixes (P0 incidents)
- Data loss prevention (corrupted data, accidental deletions)
- Cascading failure mitigation (circuit breaker triggers)

**Approval Process**:
1. **Declaration**: On-call engineer declares emergency via PagerDuty incident
2. **Incident Commander**: Assigned automatically (on-call SRE or Backend Lead)
3. **Approval**: Incident Commander has **unilateral authority** to deploy
4. **Communication**: Real-time updates in #incidents Slack channel
5. **Deployment**: Direct to production (bypass staging if time-critical)
6. **Post-Incident**:
   - Retrospective within 24 hours documenting decision rationale
   - Follow-up PR with proper tests and documentation
   - Executive report for P0/security incidents

**Rollback Authority**: Incident Commander (no approval needed)

**Change Window**: 24/7 (overrides all restrictions)

---

## Approval Authorities

### API Surface Changes

| Change Type | Approver(s) | Rationale |
|-------------|-------------|-----------|
| New endpoint (backward-compatible) | Backend Lead | Additive; no breaking changes |
| New optional field in response | Backend Lead | Backward-compatible |
| Required field → optional (relaxation) | Backend Lead | Backward-compatible |
| Optional field → required (restriction) | Backend Lead + Frontend Lead | Breaking for clients |
| Endpoint removal | Tech Architect + Product Owner | Breaking change; needs migration plan |
| Response schema change (field type) | Tech Architect + Frontend Lead | Breaking change |
| Rate limit adjustments | SRE Lead | Infrastructure impact |

### Database Schema Changes

| Change Type | Approver(s) | Rationale |
|-------------|-------------|-----------|
| New table | Backend Lead | Isolated change |
| New column (nullable) | Backend Lead | Backward-compatible |
| New column (non-null with default) | Backend Lead + DBA Lead | Application compatibility check |
| New index | DBA Lead | Performance impact analysis needed |
| Column rename (requires app coordination) | Backend Lead + DBA Lead | Requires multi-phase migration |
| Column removal | Backend Lead + DBA Lead + SRE Lead | Breaking change; downtime risk |
| Table removal | Tech Architect + DBA Lead | Data loss risk |
| Migration requiring downtime (>5 min) | Tech Architect + DBA Lead + Product Owner | Customer impact |

### Dependency Changes

| Change Type | Approver(s) | Rationale |
|-------------|-------------|-----------|
| Patch update (e.g., 5.0.1 → 5.0.2) | Auto-approved (CI gate) | Security/bug fixes |
| Minor update (e.g., 5.0 → 5.1) | Backend Lead | New features; low risk |
| Major update (e.g., 5 → 6) | Backend Lead + Tech Architect | Breaking changes possible |
| New dependency (production) | Backend Lead | Bundle size/license check |
| New dependency (dev/test) | Auto-approved (CI gate) | No production impact |
| Dependency removal | Backend Lead | Verify no usage |
| License change (e.g., MIT → GPL) | Legal + Tech Architect | Compliance risk |

### Infrastructure Changes

| Change Type | Approver(s) | Rationale |
|-------------|-------------|-----------|
| Scaling parameters (CPU/memory) | SRE Lead | Performance optimization |
| Environment variable changes | Backend Lead | Application behavior impact |
| Secret rotation | Security Lead | Security policy |
| Cloud provider change (AWS → GCP) | CTO + CFO | Major cost/risk impact |
| Region failover configuration | SRE Lead + Tech Architect | Disaster recovery |
| Cost increase >$500/month | SRE Lead + CFO | Budget impact |

---

## Change Windows

### Standard Change Windows (Medium-Risk)

**Allowed Times**:
- **Monday**: 10:00 - 16:00 UTC (avoid start-of-week rush)
- **Tuesday - Thursday**: 10:00 - 18:00 UTC (optimal window)
- **Friday**: 10:00 - 14:00 UTC (limited window before weekend)

**Restricted Times**:
- **Friday 16:00 - Monday 08:00 UTC**: Weekend freeze (emergency-only)
- **Last week of December**: Holiday freeze
- **During active P0/P1 incidents**: Change freeze except remediation

**Exceptions**: Backend Lead + SRE Lead can approve out-of-window deployments for:
- Critical bug fixes (customer-impacting)
- Security patches (HIGH+ severity)
- Performance optimizations (with monitoring plan)

### Planned Maintenance Windows (High-Risk)

**Schedule**: First Tuesday of each month, 02:00 - 06:00 UTC
- **Announcement**: 14 days in advance via email + status page
- **Duration**: Maximum 4 hours
- **Fallback**: Second Tuesday if first window fails

**Usage**:
- Breaking schema changes
- Major dependency upgrades
- Infrastructure migrations
- Multi-service coordination

---

## Deployment Procedures

### Pre-Deployment Checklist

Before deploying to production, verify:

- [ ] All tests pass in CI (unit, integration, e2e)
- [ ] Code review approved by required approvers (see approval matrix above)
- [ ] Staging deployment successful with smoke tests passing
- [ ] Rollback plan documented (specific steps, not just "revert commit")
- [ ] Database migration tested in staging (if applicable)
- [ ] Feature flags configured (for gradual rollout if medium/high-risk)
- [ ] Monitoring dashboards prepared (know what metrics to watch)
- [ ] On-call engineer notified and available for 1-hour post-deployment
- [ ] Change window compliance (not in restricted period)
- [ ] Stakeholder notification sent (for high-risk changes)

### Deployment Steps

**Standard Deployment (Low/Medium-Risk)**:
1. Merge PR to `main` branch
2. CI builds and tags artifact (semantic versioning)
3. Auto-deploy to staging environment
4. Automated smoke tests run (API health checks, database connectivity)
5. Manual QA approval via Slack reaction (👍) or CLI command
6. Auto-deploy to production with canary strategy (5% → 50% → 100% over 30 min)
7. Monitor error rates, latency, throughput for 1 hour
8. Auto-rollback if SLO violations detected (error rate >0.5%, p95 latency >250ms)

**High-Risk Deployment**:
1. Merge PR to `main` after multi-approval
2. CI builds artifact
3. Deploy to staging + full regression suite (may take 1-2 hours)
4. DBA reviews database migration plan (if schema change)
5. **Manual approval gate**: Tech Architect approves production deployment
6. Feature flag gradual rollout: 5% users → 8 hours soak → 25% → 8 hours → 50% → 8 hours → 100%
7. Incident Commander on standby during rollout
8. Manual monitoring with real-time Slack updates
9. Rollback requires dual approval (Backend Lead + SRE Lead)

### Post-Deployment Verification

Within 1 hour of deployment, verify:
- [ ] Health checks passing (`/api/v1/health`, `/api/v1/health/database`)
- [ ] Error rate <0.5% (check logs, APM dashboard)
- [ ] p95 latency <250ms (Prometheus metrics)
- [ ] No new errors in exception tracker (Sentry/Rollbar)
- [ ] Database query performance stable (no slow queries >1s)
- [ ] Socket.IO connections stable (no mass disconnects)
- [ ] Feature flag metrics showing expected rollout percentage

---

## Rollback Procedures

### Automatic Rollback Triggers

CI/CD automatically reverts to previous version if:
- Error rate increases by >0.3% absolute (e.g., 0.1% → 0.4%)
- p95 latency increases by >100ms (e.g., 150ms → 250ms)
- Health check failures >3 in 5 minutes
- Database connection pool exhaustion (>90% utilization)
- Memory usage >85% sustained for 5 minutes

**Execution**: Blue-green deployment switches traffic back to old version within 30 seconds

### Manual Rollback

**Trigger**: On-call engineer or Incident Commander determines deployment caused regression

**Procedure**:
1. Declare incident in #incidents Slack channel
2. Execute rollback command:
   ```bash
   # Revert to previous Docker tag
   kubectl rollout undo deployment/chat-backend -n production
   
   # OR revert database migration (if schema change)
   npm run prisma:migrate:rollback
   ```
3. Verify rollback success (health checks, metrics)
4. Post mortem required within 24 hours

**Database Rollback (Special Case)**:
- If migration already applied, may require manual SQL to revert
- DBA Lead must approve and execute
- May require brief downtime (<5 min) to prevent data corruption

### Rollback Testing

All high-risk changes MUST include **tested rollback plan**:
- Document exact rollback steps in PR description
- Test rollback in staging environment
- Measure rollback duration (<5 minutes target)
- Verify application stability after rollback

---

## Emergency Procedures

### Security Incident Response

If CRITICAL vulnerability disclosed (e.g., zero-day in dependency):

1. **Immediate Actions** (within 1 hour):
   - Security Lead declares incident
   - Assess blast radius (affected endpoints, data exposure)
   - Apply temporary mitigation (rate limit, disable feature flag, firewall rule)

2. **Remediation** (within 4 hours):
   - Patch dependency or apply code fix
   - Deploy to production using emergency change process
   - Notify customers if data breach (legal/compliance involved)

3. **Post-Incident** (within 24 hours):
   - Security retrospective
   - Update threat model
   - Improve detection mechanisms

### Data Loss Prevention

If accidental data deletion detected:

1. **Stop the Bleed**:
   - Immediately disable affected API endpoints (feature flag off)
   - Prevent further writes to affected tables

2. **Assess Damage**:
   - Identify affected records (use database query logs)
   - Estimate recovery time from backups

3. **Recovery**:
   - DBA restores from most recent backup (RTO: <30 min)
   - Replay write-ahead log if needed (PostgreSQL WAL)
   - Verify data integrity

4. **Communication**:
   - Notify affected users (if customer data lost)
   - Post-mortem with improved safeguards (soft deletes, audit logging)

---

## Compliance & Audit Trail

### Change Logging

All production changes are logged with:
- **What**: Commit SHA, artifact version, changed files
- **Who**: Deployer username, approvers
- **When**: Deployment timestamp (UTC), duration
- **Why**: PR link, Jira ticket, incident reference
- **Outcome**: Success/rollback, error rate, latency impact

**Retention**: 2 years (compliance requirement)

### Audit Reports

Generated monthly and reviewed by:
- Engineering Manager (change velocity, rollback rate)
- Security Lead (emergency changes, security patches)
- Compliance Officer (SOC 2 audit trail)

**Metrics Tracked**:
- Total deployments by category (low/medium/high/emergency)
- Rollback rate (target: <5%)
- Change window violations (target: 0)
- Approval bypass incidents (target: 0)
- Mean time to deploy (MTTD): Commit → production (target: <2 hours for low-risk)

---

## Continuous Improvement

### Quarterly Review

Every quarter, Tech Architect + Backend Lead review:
- Change control effectiveness (rollback rate, incident correlation)
- Approval bottlenecks (time from PR to approval)
- Change window utilization (are restrictions too strict?)
- Emergency change frequency (can we reduce with better testing?)

**Outcome**: Update this policy based on data-driven insights

### Retrospective Integration

Every post-mortem MUST answer:
- Did change control prevent this issue? (If yes, reinforce. If no, improve.)
- Were approval authorities appropriate?
- Was rollback plan adequate?

**Action Items**: Incorporated into policy updates

---

## Version History

| Version | Date | Changes | Approver |
|---------|------|---------|----------|
| 1.0 | 2025-10-20 | Initial policy | Tech Architect |

**Next Review**: 2026-01-20  
**Owner**: Tech Architect  
**Feedback**: Submit PR or email engineering@company.com
