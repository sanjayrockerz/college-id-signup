# No-Auth Policy: Chat Backend Service Scope

**Version**: 1.0  
**Effective Date**: October 20, 2025  
**Status**: Active - Permanent Policy

---

## Service Scope

This service is a **chat transport and persistence backend only**. It provides:

✅ **In Scope**:
- Real-time message transport via Socket.IO
- Message persistence and retrieval
- Conversation/room management
- User presence tracking (online/offline/typing)
- Message read receipts
- Conversation participant management
- Message history with pagination
- File attachment storage references

❌ **Out of Scope** (Permanently):
- User authentication (credential verification)
- User authorization (access control decisions)
- JWT token issuance or validation
- Password hashing or verification
- Session management
- Email verification
- OAuth integrations
- User registration/login flows
- API key management
- Current user context extraction

---

## Trust Model

### Identity as Opaque Metadata

**Principle**: This service treats `userId` as **untrusted, optional metadata** for message attribution only.

- `userId` is an opaque string identifier
- No verification of identity is performed
- No authorization decisions are based on userId
- userId may be absent, spoofed, or incorrect
- Service does not validate userId against any user registry

### Upstream Authentication Responsibility

**Architecture**: This service expects an **upstream API gateway or authentication service** to handle all identity verification.

```
┌─────────────┐      ┌──────────────┐      ┌──────────────┐
│   Client    │─────▶│   Gateway    │─────▶│ Chat Backend │
│             │      │   (Handles   │      │  (Identity   │
│             │      │    Auth)     │      │   Agnostic)  │
└─────────────┘      └──────────────┘      └──────────────┘
                           │
                           ├─ Authenticates user
                           ├─ Validates credentials
                           ├─ Checks permissions
                           └─ Passes userId (optional)
```

**Responsibilities Split**:

| Responsibility | Owner | Notes |
|----------------|-------|-------|
| User authentication | Upstream Gateway/Service | JWT validation, OAuth, passwords |
| Authorization checks | Upstream Gateway/Service | Who can access what conversations |
| Rate limiting (authenticated) | Upstream Gateway/Service | Per-user rate limits |
| userId provisioning | Upstream Gateway/Service | Optional context for attribution |
| Message transport | **This Service** | Socket.IO real-time delivery |
| Message persistence | **This Service** | Database storage and retrieval |
| Rate limiting (IP-based) | **This Service** | Abuse prevention for public API |
| Input validation | **This Service** | Payload sanitization and validation |

---

## Security Model

### Defense-in-Depth Without Authentication

Since this service does not authenticate users, security relies on:

1. **Rate Limiting (IP-based)**
   - Protects against abuse from anonymous clients
   - Different tiers for different endpoint types
   - Socket.IO event rate limiting

2. **Input Validation**
   - All payloads validated with class-validator
   - TypeScript type safety at compile time
   - Prisma schema constraints at database level

3. **Network Segmentation**
   - Service should run on private network
   - Public access only via authenticated upstream gateway
   - Direct public exposure NOT recommended for production

4. **Monitoring and Logging**
   - All requests logged with IP, endpoint, userId (if present)
   - Anomaly detection for abuse patterns
   - Alert on sustained high error rates or rate limit violations

5. **Data Sanitization**
   - No sensitive data (passwords, tokens) stored
   - User-provided content sanitized before storage
   - No execution of user-provided code

### What This Service Does NOT Protect Against

⚠️ **Security Limitations**:

- **Impersonation**: Any client can claim any userId
- **Unauthorized Access**: No enforcement of "who can read/write what"
- **Account Takeover**: No concept of "account" at this layer
- **Privilege Escalation**: No privileges to escalate
- **Audit Trail**: Cannot reliably attribute actions to real users

These protections **MUST** be implemented by the upstream service.

---

## Design Decisions

### Why No Local Authentication?

1. **Separation of Concerns**: Chat transport is distinct from identity management
2. **Simplicity**: Fewer moving parts = fewer vulnerabilities
3. **Flexibility**: Upstream can use any auth method (JWT, OAuth, sessions)
4. **No Duplication**: Avoids duplicate auth logic across services
5. **Clear Boundaries**: Explicit trust model prevents confusion

### Why Not Even Optional Authentication?

Including "optional" or "future" authentication would:
- Create confusion about trust boundaries
- Invite incomplete implementations
- Require maintaining auth code paths
- Complicate testing and validation
- Tempt future contributors to add auth features

**Decision**: Complete removal with permanent policy documentation.

---

## Integration Patterns

### Recommended: Upstream Gateway

```
┌─────────┐
│ Client  │
└────┬────┘
     │ 1. Authenticate with gateway
     ▼
┌─────────┐
│ Gateway │ ◄── Validates credentials
└────┬────┘     Issues JWT/session
     │ 2. Forward to chat backend with userId
     ▼
┌─────────┐
│  Chat   │ ◄── Accepts userId as opaque metadata
│ Backend │     No validation performed
└─────────┘
```

### Anti-Pattern: Direct Public Access

```
┌─────────┐
│ Client  │ ◄── ❌ Directly calls chat backend
└────┬────┘     ❌ No identity verification
     │          ❌ Can spoof any userId
     ▼
┌─────────┐
│  Chat   │ ◄── ❌ Cannot enforce access control
│ Backend │     ❌ No audit trail
└─────────┘
```

**Recommendation**: Do NOT expose this service directly to untrusted clients in production.

---

## Policy Enforcement

### For Contributors

**All contributions must respect this policy**:

- ✅ Features that improve message transport, persistence, or real-time delivery
- ✅ Performance optimizations for chat operations
- ✅ Bug fixes in messaging logic
- ❌ Authentication features (JWT guards, login endpoints, password handling)
- ❌ Authorization features (access control, permissions, roles)
- ❌ Identity verification (email verification, phone verification)

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for detailed guidelines.

### For Maintainers

**When reviewing PRs, reject any that**:

- Add authentication middleware or guards
- Introduce credential storage (passwords, tokens)
- Add login/register/logout endpoints
- Parse Authorization headers or cookies
- Use `req.user` for authorization decisions
- Add "TODO: add auth" comments
- Reference JWT_SECRET or similar env vars

**Instead, redirect to**:
- Upstream service for identity features
- This policy document for rationale
- Alternative designs using opaque metadata

---

## Migration from Auth-Based Systems

For systems transitioning from local authentication:

1. **Move auth to upstream service**: Implement gateway with authentication
2. **Update clients**: Remove direct chat backend calls, route via gateway
3. **Remove auth code**: Follow migration phases to eliminate auth artifacts
4. **Test anonymously**: Verify chat works with opaque userId
5. **Monitor**: Ensure upstream enforces access control

See [MIGRATION_GUIDE.md](../MIGRATION_GUIDE.md) for detailed steps.

---

## Future Considerations

### What If We Need Authentication Later?

**Answer**: Implement it upstream, not here.

If requirements change:
- Create a separate authentication service
- Add API gateway with auth middleware
- Keep this chat backend identity-agnostic
- Pass verified userId as context from gateway

**Do NOT**:
- Add authentication to this codebase
- Create a "feature flag" for optional auth
- Implement "just for now" auth solutions

### What If Upstream Doesn't Exist Yet?

**Short-term** (development/testing):
- Run this service locally without auth
- Use hardcoded userId values
- Accept the security limitations

**Before production**:
- Implement upstream authentication
- Deploy behind authenticated gateway
- Never expose this service publicly

---

## Related Documentation

- [Upstream Integration Guide](./upstream-integration.md) - How upstream services should call this backend
- [CONTRIBUTING.md](../../CONTRIBUTING.md) - Contribution guidelines including auth policy
- [API Documentation](../../API_DOCUMENTATION.md) - Trust Model section
- [Security Model](../operations/security.md) - Compensating controls for no-auth design

---

## Questions?

**Q: Why can't we just add a simple JWT check?**  
A: Separation of concerns. Authentication belongs to the identity service, not the chat transport.

**Q: How do we prevent unauthorized access?**  
A: The upstream gateway enforces access control before forwarding requests.

**Q: What if there's no upstream gateway?**  
A: Don't use this service in production without one. It's designed for internal/gateway-fronted deployment.

**Q: Can we add a feature flag for optional auth?**  
A: No. Optional auth creates confusion and maintenance burden. Auth is always upstream.

**Q: What about rate limiting per user?**  
A: Upstream gateway implements per-user rate limits. This service does IP-based rate limiting.

---

**Policy Owner**: Backend Engineering Team  
**Review Cycle**: Annual or when architecture changes  
**Exceptions**: None - This is a permanent architectural decision
