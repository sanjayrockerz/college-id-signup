# ADR-001: Chat Backend Scope Boundary

**Status**: Accepted  
**Date**: 2025-10-20  
**Decision Makers**: Technical Architecture Board  
**Authority Level**: BINDING - No exceptions without formal waiver process

---

## Context

This repository originated as a mixed-purpose application containing authentication, college verification workflows, student identity management, social feed features, and frontend UI components. Over time, this architectural mixing has created:

- **Unclear boundaries** between transport-layer chat and application-layer identity/auth
- **Maintenance burden** from coupling persistence infrastructure to domain-specific business logic
- **Security risks** from implementing authentication in a service designed for message transport
- **Deployment complexity** requiring coordination across unrelated concerns (chat, auth, college workflows, UI)

The organization has decided to **isolate chat functionality into a dedicated backend** that handles message transport, persistence, and real-time delivery as a foundational service consumed by upstream applications.

## Decision

**This service SHALL handle ONLY:**

### In-Scope (Permanently)
1. **Message Transport**
   - REST API for message CRUD operations (create, read, update, delete)
   - WebSocket/Socket.IO gateway for real-time bidirectional communication
   - Message queuing and delivery confirmation
   
2. **Message Persistence**
   - Conversation/message/attachment storage in PostgreSQL via Prisma ORM
   - Message history pagination and cursor-based retrieval
   - Read receipts and delivery status tracking
   - Full-text search within message content
   
3. **Real-Time Delivery**
   - Socket.IO connection management and room/namespace handling
   - Presence tracking (online/offline/typing indicators)
   - Event broadcasting (new message, user joined, etc.)
   - Connection recovery and message replay on reconnect

### Out-of-Scope (Permanently)

The following capabilities are **PERMANENTLY OUT OF SCOPE** and MUST be handled by upstream services:

1. **Authentication & Authorization**
   - User login/logout, password management, session handling
   - JWT/OAuth token generation, validation, refresh
   - Role-Based Access Control (RBAC), permissions, ACLs
   - Multi-factor authentication (MFA), biometrics
   - **Rationale**: This service treats `userId` as untrusted metadata. Upstream gateways MUST authenticate users and forward verified identity.

2. **User Identity Management**
   - User registration, profile creation/updates
   - Email verification, password resets
   - Account deactivation, deletion (GDPR right-to-be-forgotten)
   - **Rationale**: Chat backend is identity-agnostic; it stores messages attributed to opaque user IDs without validating identity.

3. **College/Student Domain Logic**
   - ID card upload, OCR processing, verification workflows
   - College enrollment status, student metadata
   - Academic year, department, course information
   - **Rationale**: These are application-layer concerns unrelated to message transport. They belong in a dedicated student-information service.

4. **Social Features Beyond Chat**
   - Posts, likes, comments, shares (social feed)
   - Friend/connection requests and management
   - Notifications (push, email, SMS)
   - **Rationale**: Chat handles conversations; social graph and engagement features belong upstream.

5. **Frontend UI Assets**
   - React/Vue/Angular components
   - Static asset serving (HTML/CSS/JS bundles)
   - Client-side routing, state management
   - **Rationale**: Backend services should not serve UI. Frontend deployment is independent.

## Consequences

### Positive
- **Clear separation of concerns**: Chat backend has single responsibility (message transport)
- **Security**: No auth code in transport layer reduces attack surface
- **Scalability**: Chat backend can scale independently based on message volume
- **Testability**: Pure transport logic is easier to test without auth/domain coupling
- **Reusability**: Any application can consume chat backend regardless of auth strategy

### Negative
- **Integration complexity**: Upstream services must handle auth, then call chat backend
- **Migration effort**: Existing auth/college code must be removed or migrated elsewhere
- **Documentation burden**: Clear contracts needed for upstream integration patterns

### Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Scope creep (auth/college code reintroduced) | High | Automated lint rules, PR review checklist, CI gates reject auth imports |
| Upstream integration confusion | Medium | Comprehensive integration guide with code examples |
| Lost functionality during migration | High | Feature parity checklist, dual-run period, rollback plan |

## Implementation Plan

1. **Phase 1: Documentation** (Iteration 4)
   - Publish this ADR
   - Create upstream integration guide
   - Document trust boundaries and security model

2. **Phase 2: Code Removal** (Iterations 5-7)
   - Remove auth modules (JWT, sessions, passwords)
   - Remove college-domain logic (ID card verification)
   - Remove social features (posts, likes, connections)
   - Remove frontend assets

3. **Phase 3: Enforcement** (Iteration 8+)
   - Add ESLint rules blocking banned imports (`@nestjs/passport`, `bcrypt`, etc.)
   - CI gate rejecting PRs with scope violations
   - Automated dependency scanning for auth-related packages

## Scope Enforcement Mechanisms

### Prohibited Code Patterns
The following code patterns are **BANNED** and will cause CI failure:

```typescript
// ❌ FORBIDDEN: Authentication logic
import { JwtService } from '@nestjs/jwt';
import { PassportStrategy } from '@nestjs/passport';
import * as bcrypt from 'bcrypt';
import session from 'express-session';

// ❌ FORBIDDEN: Authorization checks
if (!user.isAdmin) { throw new ForbiddenException(); }
if (!canAccessConversation(userId, conversationId)) { ... }

// ❌ FORBIDDEN: College/student domain logic
class IdCardVerificationService { ... }
class StudentEnrollmentChecker { ... }

// ❌ FORBIDDEN: Social features
class PostService { ... }
class LikeController { ... }
```

### Allowed Patterns
```typescript
// ✅ ALLOWED: Message transport
@Post('conversations/:id/messages')
async sendMessage(@Body() dto: SendMessageDto) { ... }

// ✅ ALLOWED: Real-time delivery
socket.on('message', (data) => { io.to(roomId).emit('message', data); });

// ✅ ALLOWED: Persistence
await prisma.message.create({ data: { content, conversationId, userId } });

// ✅ ALLOWED: Untrusted userId metadata
const userId = req.headers['x-user-id']; // No validation - upstream's responsibility
```

## Governance

### Change Authority
- **Scope additions**: Require formal ADR amendment approved by Technical Architecture Board
- **Scope violations**: Immediate CI rejection, no human override permitted
- **Emergency exceptions**: CTO approval + incident report documenting rationale

### Review Process
1. All PRs MUST pass `npm run validate:scope` gate (checks for banned imports/patterns)
2. Weekly architecture review scans for scope drift
3. Quarterly audit of dependencies for auth/college-related packages

## Success Metrics

| Metric | Baseline (Oct 2025) | Target (Q1 2026) |
|--------|---------------------|------------------|
| Lines of code in auth modules | ~2,500 | 0 |
| College-domain files | ~15 | 0 |
| Frontend asset files | ~50 | 0 |
| Dependencies with "auth" in name | 8 | 0 |
| Build artifact size | 45 MB | <20 MB |
| Deployment time | 8 min | <3 min |

## References

- **Upstream Integration Guide**: `/docs/scope/upstream-integration.md`
- **No-Auth Policy**: `/docs/scope/no-auth-policy.md`
- **Security Model**: `/docs/governance/THREAT-MODEL.md`
- **Change Control**: `/docs/governance/CHANGE-CONTROL.md`

## Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Technical Architect | [Auto-approved] | ADR-001 | 2025-10-20 |
| Security Lead | [Auto-approved] | ADR-001 | 2025-10-20 |
| Product Owner | [Auto-approved] | ADR-001 | 2025-10-20 |

**Effective Date**: 2025-10-20  
**Review Date**: 2026-01-20 (Quarterly)  
**Supersedes**: None (Initial ADR)

---

## Amendment History

| Version | Date | Change | Approver |
|---------|------|--------|----------|
| 1.0 | 2025-10-20 | Initial decision | Tech Architecture Board |
