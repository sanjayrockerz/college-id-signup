# Ownership Matrix - Chat Backend

**Version**: 1.0  
**Effective Date**: 2025-10-20  
**Review Cycle**: Quarterly  
**Authority**: RACI Model (Responsible, Accountable, Consulted, Informed)

---

## Executive Summary

This document defines **Directly Responsible Individuals (DRIs)** and **decision-making authority** for all aspects of the chat backend service. It establishes clear ownership to prevent ambiguity, enable rapid incident response, and ensure accountability for service reliability.

## Ownership Principles

1. **Single DRI**: Each area has ONE accountable person (the "A" in RACI)
2. **No orphaned components**: Every file, API, infrastructure element has a designated owner
3. **Escalation clarity**: DRIs have authority to make decisions; escalation paths defined for conflicts
4. **On-call rotation**: Production incidents follow escalation matrix below

---

## RACI Matrix

### Legend
- **R** = Responsible (Does the work)
- **A** = Accountable (Final decision authority, only ONE per area)
- **C** = Consulted (Input sought before decisions)
- **I** = Informed (Notified after decisions)

---

## 1. HTTP API Surface

**Scope**: REST endpoints, request/response contracts, versioning, deprecation policy

| Area | DRI (A) | Support (R) | Stakeholders (C/I) |
|------|---------|-------------|-------------------|
| `/api/v1/chat/*` endpoints | Backend Lead | Backend Team (R) | Frontend Team (C), QA (I) |
| `/api/v1/health` endpoints | SRE Lead | Backend Team (R) | Ops Team (I) |
| API versioning strategy | Tech Architect | Backend Lead (C) | Product (C), Frontend (I) |
| Breaking change approvals | Tech Architect (A) | Backend Lead (C) | All teams (I) |
| Deprecation timelines | Product Owner (A) | Backend Lead (C) | Frontend (C), Partners (I) |

**Decision Authority**:
- **Additive changes** (new endpoints, optional fields): Backend Lead can approve
- **Breaking changes** (removing fields, changing types): Requires Tech Architect + Product Owner sign-off
- **Emergency hotfixes**: Backend Lead can deploy; retrospective review within 24h

**Escalation Path**: Backend Lead → Tech Architect → CTO

---

## 2. Socket.IO Gateway

**Scope**: WebSocket connections, event schemas, room management, reconnection logic

| Area | DRI (A) | Support (R) | Stakeholders (C/I) |
|------|---------|-------------|-------------------|
| Socket.IO event contracts | Backend Lead | Backend Team (R) | Frontend Team (C) |
| Connection lifecycle (connect/disconnect/reconnect) | Backend Lead | Backend Team (R) | SRE (C), QA (I) |
| Room/namespace design | Backend Lead | Backend Team (R) | Frontend (C) |
| Performance tuning (max connections, memory limits) | SRE Lead | Backend Lead (C) | Ops (R) |
| Client library version compatibility | Backend Lead | Frontend Lead (C) | QA (I) |

**Decision Authority**:
- **Event schema changes**: Backend Lead (with Frontend consultation)
- **Scaling parameters**: SRE Lead (with Backend consultation)
- **Protocol upgrades** (Socket.IO v4 → v5): Tech Architect approval required

**Escalation Path**: Backend Lead → SRE Lead → Tech Architect

---

## 3. Prisma Schema & Migrations

**Scope**: Database schema, migrations, indexes, constraints, seeding

| Area | DRI (A) | Support (R) | Stakeholders (C/I) |
|------|---------|-------------|-------------------|
| Prisma schema changes (`schema.prisma`) | Backend Lead | Backend Team (R) | DBA (C), SRE (I) |
| Migration generation and testing | Backend Lead | Backend Team (R) | QA (C) |
| Production migration execution | DBA Lead | Backend Lead (C) | SRE (C), Ops (I) |
| Index optimization | DBA Lead | Backend Lead (C) | SRE (C) |
| Data seeding scripts | Backend Lead | Backend Team (R) | QA (C) |
| Rollback procedures | DBA Lead | Backend Lead (C) | SRE (R) |

**Decision Authority**:
- **Schema changes**: Backend Lead can approve if backward-compatible; DBA Lead consult required for indexes/constraints
- **Breaking migrations**: DBA Lead + Backend Lead + SRE Lead sign-off
- **Emergency rollback**: DBA Lead can execute; Backend Lead notified

**Escalation Path**: Backend Lead → DBA Lead → VP Engineering

---

## 4. Infrastructure & Configuration

**Scope**: Environment variables, deployment manifests, cloud resources, scaling policies

| Area | DRI (A) | Support (R) | Stakeholders (C/I) |
|------|---------|-------------|-------------------|
| Environment variable definitions | Backend Lead | Backend Team (R) | SRE (C), Security (I) |
| Docker/Kubernetes manifests | SRE Lead | DevOps Team (R) | Backend (C) |
| Cloud resources (AWS/GCP/Azure) | SRE Lead | DevOps Team (R) | Finance (I) |
| Auto-scaling policies | SRE Lead | Backend Lead (C) | Ops (R) |
| Secret management (AWS Secrets Manager, Vault) | Security Lead | SRE (R) | Backend (C) |
| Cost optimization | SRE Lead | Finance (C) | Engineering (I) |

**Decision Authority**:
- **Config changes**: Backend Lead for app configs; SRE Lead for infra configs
- **Resource provisioning**: SRE Lead (with Finance approval for >$500/month)
- **Security policies**: Security Lead (no exceptions)

**Escalation Path**: SRE Lead → VP Engineering → CTO

---

## 5. Documentation

**Scope**: API docs, architecture diagrams, runbooks, onboarding guides

| Area | DRI (A) | Support (R) | Stakeholders (C/I) |
|------|---------|-------------|-------------------|
| API documentation (OpenAPI/Swagger) | Backend Lead | Backend Team (R) | Tech Writer (C), Frontend (I) |
| Architecture Decision Records (ADRs) | Tech Architect | Backend Lead (C) | All teams (I) |
| Runbooks and incident response guides | SRE Lead | Backend Lead (C) | Ops (R) |
| Developer onboarding guides | Backend Lead | Backend Team (R) | HR (I) |
| Governance docs (this file) | Tech Architect | Backend Lead (C) | Legal (I) |
| Changelog and release notes | Backend Lead | Backend Team (R) | Product (C), Support (I) |

**Decision Authority**:
- **Technical accuracy**: Backend Lead final authority
- **Governance/compliance**: Tech Architect final authority
- **Publication timing**: Product Owner for external docs; Backend Lead for internal

**Escalation Path**: Backend Lead → Tech Architect → CTO

---

## 6. Quality Gates & CI/CD

**Scope**: Test coverage, linting rules, CI pipelines, deployment automation

| Area | DRI (A) | Support (R) | Stakeholders (C/I) |
|------|---------|-------------|-------------------|
| Test coverage thresholds | QA Lead | Backend Team (R) | Backend Lead (C) |
| ESLint/Prettier rules | Backend Lead | Backend Team (R) | Tech Architect (C) |
| CI pipeline configuration (GitHub Actions) | DevOps Lead | Backend Team (R) | SRE (C) |
| Deployment gates (manual approvals) | SRE Lead | Backend Lead (C) | Product (I) |
| Automated rollback triggers | SRE Lead | DevOps Team (R) | Backend (C) |
| Security scanning (Snyk, npm audit) | Security Lead | DevOps (R) | Backend (I) |

**Decision Authority**:
- **Coverage floors**: QA Lead can set; Backend Lead can request exemptions
- **Lint rules**: Backend Lead (with team consensus)
- **Deployment strategy**: SRE Lead (canary, blue-green, etc.)

**Escalation Path**: QA Lead / DevOps Lead → Tech Architect

---

## 7. Incident Response & On-Call

**Scope**: Production incidents, post-mortems, escalation, 24/7 coverage

| Area | DRI (A) | Support (R) | Stakeholders (C/I) |
|------|---------|-------------|-------------------|
| Incident Commander (P0/P1 incidents) | On-Call SRE | Backend On-Call (R) | Product (I), Exec (I) |
| Post-mortem authoring | Incident Commander | Impacted teams (C) | All (I) |
| On-call rotation schedule | SRE Lead | Backend Lead (C) | HR (I) |
| Alert definitions and thresholds | SRE Lead | Backend Lead (C) | Ops (R) |
| Runbook maintenance | SRE Lead | Backend Team (R) | - |
| Incident retrospectives | SRE Lead | Incident Commander (R) | All teams (C) |

**On-Call Rotation**:
- **Primary**: Backend Team (7-day rotation)
- **Secondary**: SRE Team (escalation within 15 minutes)
- **Tertiary**: Backend Lead (escalation within 30 minutes)

**Escalation Matrix**:
1. **P0 (Critical outage)**: Immediate page → On-Call SRE + Backend On-Call → Incident Commander declared → CTO notified within 15 min
2. **P1 (Major degradation)**: Page → On-Call Backend → SRE consulted → VP Engineering notified within 1 hour
3. **P2 (Minor issue)**: Ticket → Backend Team → Resolved during business hours
4. **P3 (Low priority)**: Ticket → Backlog → Triaged weekly

**Decision Authority**:
- **Incident response actions**: Incident Commander has full authority (no approval needed)
- **Post-incident improvements**: SRE Lead prioritizes remediation work
- **On-call policy changes**: SRE Lead + Backend Lead joint approval

**Escalation Path**: On-Call SRE → SRE Lead → VP Engineering → CTO

---

## 8. Security & Compliance

**Scope**: Vulnerability management, data privacy, compliance audits

| Area | DRI (A) | Support (R) | Stakeholders (C/I) |
|------|---------|-------------|-------------------|
| Security vulnerability remediation | Security Lead | Backend Team (R) | SRE (C) |
| GDPR/data privacy compliance | Legal/Compliance | Backend Lead (C) | Security (C) |
| Penetration testing coordination | Security Lead | SRE (R) | Backend (C) |
| Incident response (security breaches) | Security Lead | SRE (R) | Legal (I), Exec (I) |
| Dependency security scanning | Security Lead | DevOps (R) | Backend (I) |

**Decision Authority**:
- **CRITICAL vulnerabilities**: Security Lead can mandate immediate patches (no approval needed)
- **HIGH vulnerabilities**: Backend Lead schedules remediation within 7 days
- **Data retention policies**: Legal/Compliance (Security Lead consulted)

**Escalation Path**: Security Lead → CISO → CEO (for breaches)

---

## Contact Information

| Role | Name (Placeholder) | Email | Slack | Phone |
|------|-------------------|-------|-------|-------|
| Backend Lead | [TBD] | backend-lead@company.com | @backend-lead | [On-Call] |
| SRE Lead | [TBD] | sre-lead@company.com | @sre-lead | [On-Call] |
| Tech Architect | [TBD] | architect@company.com | @tech-arch | [On-Call] |
| DBA Lead | [TBD] | dba-lead@company.com | @dba-lead | [On-Call] |
| Security Lead | [TBD] | security@company.com | @security | [On-Call] |
| QA Lead | [TBD] | qa-lead@company.com | @qa-lead | [Business Hours] |
| DevOps Lead | [TBD] | devops-lead@company.com | @devops | [Business Hours] |
| Product Owner | [TBD] | product@company.com | @product | [Business Hours] |

**On-Call Pager**: [PagerDuty/OpsGenie rotation TBD]

---

## Decision-Making Principles

### Autonomy Levels

**Level 1 - Full Autonomy (No approval needed)**:
- Backward-compatible API changes (new optional fields)
- Bug fixes with test coverage
- Documentation updates
- Performance optimizations without schema changes
- Log level adjustments

**Level 2 - Consultation Required (DRI decides after input)**:
- New API endpoints
- Database schema changes (backward-compatible)
- Dependency upgrades (minor/patch versions)
- Environment variable additions
- Infrastructure scaling adjustments

**Level 3 - Joint Approval (Multiple DRIs sign-off)**:
- Breaking API changes
- Database migrations requiring downtime
- Major dependency upgrades (major versions)
- Security policy changes
- Cost-impacting infrastructure changes (>$500/month)

**Level 4 - Executive Approval (C-level sign-off)**:
- Architecture paradigm shifts (e.g., microservices split)
- Vendor migrations (e.g., AWS → GCP)
- Compliance/legal framework changes
- Service SLA downgrades

---

## Conflict Resolution

1. **Peer-level conflicts**: DRIs negotiate; if no consensus within 2 business days → escalate to shared manager
2. **Cross-functional conflicts**: Tech Architect mediates; decision binding within 1 business day
3. **Urgent conflicts**: Incident Commander has final authority during incidents (retrospective review required)

---

## Accountability Metrics

| Role | Key Metric | Target | Review Frequency |
|------|-----------|--------|------------------|
| Backend Lead | API uptime | >99.9% | Monthly |
| SRE Lead | MTTR (Mean Time To Recovery) | <30 min (P0) | Weekly |
| DBA Lead | Query p95 latency | <250ms | Weekly |
| Security Lead | CRITICAL vulns open | 0 | Daily |
| QA Lead | Test coverage | >75% | Sprint |

---

## Amendment Process

1. **Propose change**: Submit PR updating this document
2. **Review**: Tech Architect + affected DRIs review within 3 business days
3. **Approval**: Requires sign-off from Tech Architect + 2 DRIs
4. **Effective date**: Changes take effect immediately upon merge
5. **Communication**: Slack announcement in #engineering + email to all stakeholders

**Last Reviewed**: 2025-10-20  
**Next Review**: 2026-01-20  
**Version**: 1.0
