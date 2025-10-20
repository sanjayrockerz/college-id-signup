# Threat Model - Chat Backend

**Version**: 1.0  
**Date**: 2025-10-20  
**Classification**: INTERNAL USE  
**Review Cycle**: Quarterly or after security incidents

---

## Executive Summary

This document provides a **comprehensive threat analysis** for the chat backend service operating in a **no-authentication, public endpoint** model. Since this service does NOT authenticate users and treats all requests as potentially malicious, the threat model focuses on:

1. **Attack surface** from public HTTP/WebSocket exposure
2. **Compensating controls** to mitigate risks without authentication
3. **Defense-in-depth** strategies assuming upstream auth failures
4. **Incident detection** and response procedures

**Key Finding**: Without authentication, the service is vulnerable to abuse. **Critical dependency**: Upstream API gateway MUST enforce authentication and authorization before forwarding requests.

---

## Trust Boundaries

### External Trust Boundary

```
┌─────────────────────────────────────────────────────────────┐
│  UNTRUSTED ZONE (Public Internet)                          │
│  - Anonymous clients                                        │
│  - Malicious actors                                         │
│  - Botnets, scrapers, DDoS sources                         │
└─────────────────────────────────────────────────────────────┘
                           ↓
        ══════════════════════════════════════
        ║   FIREWALL / WAF / RATE LIMITER    ║  ← First defense layer
        ══════════════════════════════════════
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  UPSTREAM API GATEWAY (Authenticated Zone)                  │
│  - JWT validation, OAuth, session handling                  │
│  - Authorization (user can access conversation X?)          │
│  - Request enrichment (verified userId from token)          │
└─────────────────────────────────────────────────────────────┘
                           ↓
        ══════════════════════════════════════
        ║   PRIVATE NETWORK (VPC/Subnet)     ║  ← Network isolation
        ══════════════════════════════════════
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  CHAT BACKEND (This Service - NO AUTHENTICATION)           │
│  - Treats userId as untrusted metadata                      │
│  - No identity verification                                 │
│  - No access control (assumes upstream handled it)         │
│  ⚠️  ASSUMES: Upstream validated user identity & authz      │
└─────────────────────────────────────────────────────────────┘
                           ↓
        ══════════════════════════════════════
        ║   DATABASE (Encrypted at Rest)     ║  ← Data layer
        ══════════════════════════════════════
```

### Internal Trust Boundary

**Trusted**:
- Database (PostgreSQL) - assumes credentials secured, network isolated
- Internal services within VPC (monitoring, logging, metrics collectors)
- CI/CD pipeline with signed artifacts

**Untrusted**:
- ALL HTTP/WebSocket requests (even if from upstream gateway - defense in depth)
- User-provided data (message content, file uploads, metadata)
- Third-party dependencies (npm packages - vetted via security scans)

---

## Threat Categories (STRIDE Analysis)

### 1. Spoofing Identity

**Threat**: Attacker sends requests with forged `userId` to impersonate another user

**Attack Scenarios**:
- **Scenario A**: Attacker crafts HTTP request with `X-User-ID: victim-user-123` to read victim's messages
- **Scenario B**: WebSocket client connects with fake userId to receive real-time messages intended for others
- **Scenario C**: Attacker enumerates userIds (user-1, user-2, ...) to discover valid accounts

**Likelihood**: **CRITICAL** (if exposed directly to internet without upstream auth)  
**Impact**: **CRITICAL** (full account takeover, message eavesdropping, privacy violation)

**Mitigations**:
1. **REQUIRED**: Deploy behind authenticated API gateway (AWS API Gateway, Kong, NGINX with JWT plugin)
   - Gateway validates JWT/OAuth token
   - Gateway extracts verified userId from token claims
   - Gateway forwards `X-User-ID` header (backend trusts this header ONLY from gateway)
2. **Network isolation**: Chat backend accessible ONLY from gateway's VPC subnet (firewall rules)
3. **Header validation**: Reject requests without `X-Gateway-Validated: true` header (set by gateway)
4. **Audit logging**: Log all requests with userId, IP, timestamp for forensic analysis
5. **Anomaly detection**: Alert if single IP uses >10 distinct userIds within 1 hour (likely spoofing)

**Residual Risk**: LOW (with mitigations); CRITICAL (without upstream auth)

---

### 2. Tampering with Data

**Threat**: Attacker modifies message content, conversation metadata, or database records

**Attack Scenarios**:
- **Scenario A**: SQL injection via malicious message content (`'; DROP TABLE messages; --`)
- **Scenario B**: NoSQL injection in conversation search queries
- **Scenario C**: Modifying message timestamps to reorder conversation history
- **Scenario D**: Injecting XSS payloads in message content to exploit frontend clients

**Likelihood**: **HIGH** (without input validation)  
**Impact**: **HIGH** (data corruption, injection attacks, client compromise)

**Mitigations**:
1. **Parameterized queries**: Prisma ORM prevents SQL injection (no raw SQL allowed except audited queries)
2. **Input validation**: `class-validator` on all DTOs:
   ```typescript
   class SendMessageDto {
     @IsString()
     @Length(1, 10000) // Max 10KB message
     content: string;
     
     @IsEnum(['TEXT', 'IMAGE', 'FILE'])
     messageType: MessageType;
   }
   ```
3. **Output encoding**: Sanitize message content before serving to clients (prevent XSS)
4. **Immutable history**: Messages cannot be edited/deleted after creation (append-only log)
5. **Database constraints**: Foreign keys, check constraints, unique indexes prevent invalid states
6. **Content Security Policy**: Serve API responses with `Content-Type: application/json` (never HTML)

**Residual Risk**: LOW (with validation); MEDIUM (XSS risk remains if frontend doesn't sanitize)

---

### 3. Repudiation

**Threat**: User denies sending a message or performing an action

**Attack Scenarios**:
- **Scenario A**: User claims "I didn't send that offensive message" (plausible deniability)
- **Scenario B**: Attacker sends messages, then deletes audit logs to cover tracks
- **Scenario C**: Disputed timestamp/read-receipt status in legal proceedings

**Likelihood**: **MEDIUM** (without non-repudiation controls)  
**Impact**: **MEDIUM** (legal disputes, accountability failures)

**Mitigations**:
1. **Comprehensive audit logging**: Every message creation logged with:
   - userId, conversationId, messageId, timestamp (UTC), IP address, User-Agent
   - Immutable logs (append-only, stored in tamper-evident system like AWS CloudWatch Logs)
2. **Digital signatures** (optional, future enhancement): Sign messages with user's private key
3. **Retention policy**: Logs retained for 2 years (compliance requirement)
4. **Access controls**: Audit logs accessible only to DBA + Security team
5. **Tamper detection**: Log checksums/hashes to detect modifications

**Residual Risk**: LOW (with audit logging); MEDIUM (if logs not protected)

---

### 4. Information Disclosure

**Threat**: Unauthorized access to private conversations or sensitive data

**Attack Scenarios**:
- **Scenario A**: Conversation enumeration (try conversationId 1, 2, 3, ... until finding accessible conversations)
- **Scenario B**: Database backup leaked (unencrypted messages exposed)
- **Scenario C**: Error messages leak sensitive info (`User 'admin' does not exist in conversation X`)
- **Scenario D**: Timing attacks reveal conversation existence (faster response if conversation exists)
- **Scenario E**: Memory dumps expose message content in plaintext

**Likelihood**: **HIGH** (without access control and encryption)  
**Impact**: **CRITICAL** (privacy violation, regulatory fines under GDPR/CCPA)

**Mitigations**:
1. **Upstream authorization**: Gateway enforces "user can access conversation X" check before forwarding request
2. **Database encryption at rest**: PostgreSQL TDE (Transparent Data Encryption) or AWS RDS encryption
3. **Encryption in transit**: TLS 1.3 for all connections (client ↔ backend, backend ↔ database)
4. **Generic error messages**: Never expose PII or internal state:
   ```typescript
   // ❌ BAD
   throw new Error(`User ${userId} not found in conversation ${conversationId}`);
   
   // ✅ GOOD
   throw new NotFoundException('Resource not found');
   ```
5. **Constant-time lookups**: Avoid timing-based information leaks in conversation existence checks
6. **Memory protection**: Disable core dumps in production (`ulimit -c 0`), use memory-safe data handling
7. **Log redaction**: PII redacted from logs (message content logged as `[REDACTED]`, only metadata logged)

**Residual Risk**: MEDIUM (encryption mitigates but access control relies on upstream)

---

### 5. Denial of Service (DoS)

**Threat**: Attacker overwhelms service with requests, causing unavailability

**Attack Scenarios**:
- **Scenario A**: HTTP flood (millions of POST /messages requests)
- **Scenario B**: WebSocket connection exhaustion (open 100K connections, hold indefinitely)
- **Scenario C**: Database saturation (complex queries causing table locks)
- **Scenario D**: Message bomb (send 10MB message payloads to exhaust storage/bandwidth)
- **Scenario E**: Slowloris attack (slow HTTP requests tying up threads)

**Likelihood**: **HIGH** (public endpoints attractive to attackers)  
**Impact**: **HIGH** (service unavailable, customer impact, revenue loss)

**Mitigations**:
1. **Rate limiting** (per IP address):
   - General API: 100 requests / 15 minutes
   - Messaging: 200 messages / 15 minutes
   - File uploads: 10 uploads / 15 minutes
   - WebSocket connections: 5 connections / IP
2. **Request size limits**:
   - JSON payload: 10 MB max
   - File upload: 5 MB max per file
   - WebSocket message: 1 MB max
3. **Connection limits**:
   - Max concurrent connections: 10,000 (configurable)
   - Idle timeout: 5 minutes (disconnect inactive WebSocket)
   - Slow request timeout: 30 seconds (abort slow clients)
4. **Database query timeout**: 5 seconds max (prevent long-running queries)
5. **Auto-scaling**: Horizontal pod autoscaling (HPA) based on CPU/memory/request rate
6. **CDN/WAF**: CloudFlare or AWS WAF to absorb DDoS attacks before reaching backend
7. **Circuit breaker**: Stop accepting new connections if database saturated (>80% connection pool usage)
8. **Backpressure**: Queue messages if processing can't keep up (Redis queue with max depth)

**Residual Risk**: MEDIUM (distributed DDoS can still overwhelm even with mitigations)

---

### 6. Elevation of Privilege

**Threat**: Attacker gains admin/elevated permissions to perform restricted actions

**Attack Scenarios**:
- **Scenario A**: Path traversal to access admin endpoints (`/api/v1/admin/../../../etc/passwd`)
- **Scenario B**: Parameter tampering to set `isAdmin: true` in request body
- **Scenario C**: JWT algorithm confusion (if backend accidentally validates tokens - but we don't!)
- **Scenario D**: Dependency vulnerability allows RCE (Remote Code Execution)

**Likelihood**: **MEDIUM** (defense in depth still needed)  
**Impact**: **CRITICAL** (full system compromise)

**Mitigations**:
1. **No admin endpoints in chat backend**: Admin features belong in separate admin service
2. **Input validation**: Reject unexpected fields (e.g., `isAdmin` in SendMessageDto)
3. **Least privilege**: Database user has only SELECT/INSERT/UPDATE/DELETE (no CREATE/DROP)
4. **Dependency scanning**: `npm audit` in CI/CD, fail build on HIGH/CRITICAL vulnerabilities
5. **Container security**: Non-root user in Docker, read-only filesystem where possible
6. **Network segmentation**: Backend cannot initiate outbound connections (except to database)
7. **Code review**: 2-person review for security-sensitive changes

**Residual Risk**: LOW (with defense in depth)

---

## Attack Surface Analysis

### Public Endpoints (High-Risk)

#### HTTP REST API

**Endpoints**:
- `POST /api/v1/chat/conversations` - Create conversation
- `POST /api/v1/chat/conversations/:id/messages` - Send message
- `GET /api/v1/chat/conversations/:id/messages` - Retrieve history
- `GET /api/v1/chat/conversations` - List user's conversations

**Attack Vectors**:
- **Injection**: SQL, NoSQL, command injection via message content
- **Enumeration**: Brute-force conversationId to find accessible conversations
- **Parameter pollution**: Duplicate parameters, unexpected fields
- **Large payloads**: 100 MB message content to exhaust memory

**Controls**:
- Input validation (class-validator)
- Parameterized queries (Prisma ORM)
- Rate limiting (100 req/15 min per IP)
- Payload size limits (10 MB max)

#### WebSocket (Socket.IO)

**Events**:
- `connection` - Establish WebSocket
- `join` - Join conversation room
- `message` - Send real-time message
- `disconnect` - Close connection

**Attack Vectors**:
- **Connection flood**: Open 100K connections from botnet
- **Room hijacking**: Join conversation rooms without authorization
- **Message spam**: Send 1000 messages/second via WebSocket
- **Resource exhaustion**: Never disconnect, hold memory indefinitely

**Controls**:
- Connection limits (5 per IP, 10K total)
- Idle timeout (5 min)
- Message rate limiting (10 msg/sec per connection)
- Room membership validation (check userId authorized for conversation)

### Internal Endpoints (Medium-Risk)

#### Health Checks

**Endpoints**:
- `GET /api/v1/health` - Service health
- `GET /api/v1/health/database` - Database connectivity

**Attack Vectors**:
- **Information disclosure**: Health endpoint leaks internal state (database version, memory usage)
- **Amplification**: Use health endpoint in DDoS reflection attack

**Controls**:
- Generic responses (no internal details in health checks)
- Rate limiting (100 req/15 min)
- Authentication (consider requiring API key even for health checks)

#### Metrics Endpoint

**Endpoint**: `GET /metrics` - Prometheus metrics

**Attack Vectors**:
- **Information disclosure**: Metrics reveal traffic patterns, user counts, system topology
- **DDoS**: Metrics endpoint may be computationally expensive

**Controls**:
- **Restrict access**: Metrics endpoint accessible ONLY from monitoring VPC subnet (firewall rule)
- **Authentication**: Require basic auth or IP whitelist
- **Caching**: Metrics cached for 10 seconds (reduce computation)

---

## Compensating Controls (No-Auth Model)

Since this service does NOT implement authentication, the following compensating controls are **MANDATORY**:

### 1. Network-Level Controls

**Requirement**: Backend accessible ONLY from authenticated upstream gateway

**Implementation**:
- **VPC subnet isolation**: Chat backend in private subnet (no internet route)
- **Security groups**: Allow ingress ONLY from gateway's IP/subnet
- **Service mesh**: Istio/Linkerd mutual TLS between gateway ↔ backend

**Validation**: 
```bash
# Test: Direct request should fail (timeout or connection refused)
curl https://chat-backend.internal:3001/api/v1/health
# Expected: Connection timeout (not accessible from internet)

# Test: Request via gateway should succeed
curl https://api.company.com/chat/health
# Expected: 200 OK (gateway authenticated request)
```

### 2. Request Header Validation

**Requirement**: Reject requests without trusted gateway headers

**Implementation**:
```typescript
// Middleware in NestJS
@Injectable()
export class GatewayHeaderGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    
    // Check gateway validation header (gateway sets this after auth)
    const gatewayHeader = request.headers['x-gateway-validated'];
    if (gatewayHeader !== process.env.GATEWAY_SECRET) {
      throw new ForbiddenException('Request must come from authenticated gateway');
    }
    
    // Check userId present (gateway extracted from JWT)
    if (!request.headers['x-user-id']) {
      throw new BadRequestException('Missing userId');
    }
    
    return true;
  }
}
```

**Configuration**:
- `GATEWAY_SECRET`: Shared secret between gateway and backend (rotate monthly)
- Applied globally to all endpoints except `/metrics` and `/health`

### 3. Rate Limiting (IP-Based)

**Requirement**: Limit request rate per IP to prevent abuse

**Implementation**:
```typescript
import rateLimit from 'express-rate-limit';

// General API rate limit
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Max 100 requests per 15 min
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

// Messaging rate limit (higher threshold)
const messageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200, // 200 messages per 15 min
});

// Apply to routes
app.use('/api/v1/chat', messageLimiter);
app.use('/api/v1', apiLimiter);
```

**Monitoring**: Alert if 10+ IPs hit rate limit within 1 hour (possible DDoS)

### 4. Input Validation (Defense in Depth)

**Requirement**: Validate ALL user input, even if upstream validated

**Implementation**:
```typescript
// DTO with class-validator
export class SendMessageDto {
  @IsString()
  @Length(1, 10000, { message: 'Message must be 1-10,000 characters' })
  content: string;

  @IsEnum(['TEXT', 'IMAGE', 'FILE'], { message: 'Invalid message type' })
  messageType: MessageType;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];
}

export class AttachmentDto {
  @IsString()
  @Length(1, 255)
  filename: string;

  @IsString()
  @Matches(/^(image|application|video)\/(jpeg|png|gif|pdf|mp4)$/, {
    message: 'Invalid MIME type',
  })
  mimetype: string;

  @IsString()
  @IsUrl({ require_protocol: true })
  url: string;

  @IsNumber()
  @Min(1)
  @Max(5 * 1024 * 1024) // 5 MB max
  size: number;
}
```

**Global pipe**:
```typescript
app.useGlobalPipes(new ValidationPipe({
  whitelist: true, // Strip non-whitelisted properties
  forbidNonWhitelisted: true, // Throw error if extra properties
  transform: true, // Transform payloads to DTO instances
}));
```

### 5. Structured Logging (PII Redaction)

**Requirement**: Log all requests for forensics, but redact sensitive data

**Implementation**:
```typescript
import { Logger } from '@nestjs/common';

const logger = new Logger('ChatBackend');

// Log request (redact message content)
logger.log({
  event: 'message.sent',
  userId: req.headers['x-user-id'],
  conversationId: dto.conversationId,
  messageType: dto.messageType,
  messageLength: dto.content.length, // Log length, not content
  timestamp: new Date().toISOString(),
  ip: req.ip,
  userAgent: req.headers['user-agent'],
});

// DO NOT LOG:
// - Message content (PII)
// - Attachment URLs (may contain tokens)
// - User personal info (email, phone)
```

**Retention**: Logs retained for 90 days (GDPR requirement)

### 6. Anomaly Detection

**Requirement**: Detect and alert on suspicious patterns

**Rules**:
1. **User enumeration**: If single IP queries >10 distinct userIds in 1 hour → alert
2. **Conversation scanning**: If userId tries to access >50 conversations in 1 minute → alert
3. **Message spam**: If userId sends >100 messages in 1 minute → rate limit + alert
4. **Geographic anomaly**: If userId's IP changes countries within 5 minutes → alert (VPN/proxy usage)
5. **Error rate spike**: If 4xx error rate >10% within 5 minutes → alert (potential attack)

**Action**: Automatic IP blocking for 1 hour + PagerDuty alert to on-call SRE

---

## Data Protection

### Encryption

**At Rest**:
- PostgreSQL: TDE (Transparent Data Encryption) via AWS RDS encryption
- Backups: Encrypted with AES-256, stored in S3 with server-side encryption
- Logs: CloudWatch Logs encrypted by default

**In Transit**:
- Client ↔ Backend: TLS 1.3 (force HTTPS, HSTS header)
- Backend ↔ Database: PostgreSQL SSL mode `require`
- Backend ↔ Internal services: mTLS via service mesh

### Key Management

- TLS certificates: AWS ACM (auto-renewal)
- Database credentials: AWS Secrets Manager (auto-rotation every 30 days)
- Encryption keys: AWS KMS (FIPS 140-2 Level 2 validated)
- Gateway shared secret: Manual rotation quarterly

### Data Minimization

**Principle**: Collect only data necessary for message transport

**Stored**:
- ✅ Message content (required for persistence)
- ✅ Timestamp, userId, conversationId (required for retrieval)
- ✅ Message type (TEXT/IMAGE/FILE) (required for rendering)

**NOT Stored**:
- ❌ User passwords (out of scope - upstream handles auth)
- ❌ Email addresses (not needed for chat transport)
- ❌ IP addresses in database (only in transient logs)
- ❌ Geolocation data (privacy violation)

---

## Incident Detection & Response

### Detection Mechanisms

**Real-Time Alerts** (PagerDuty):
- Error rate >0.5% for 5 minutes (P1 incident)
- p95 latency >250ms sustained for 5 minutes (P2)
- Database connection pool >80% for 5 minutes (P1)
- Security scan detects CRITICAL vulnerability (P0)
- 10+ IPs hit rate limit simultaneously (possible DDoS) (P1)

**Daily Reports** (Email to security team):
- Top 10 IPs by request volume
- Unusual user activity (geographic anomalies)
- Failed authentication attempts (from gateway logs)
- Dependency security scan results

### Incident Response Procedures

**P0 Security Breach** (Data exfiltration, RCE, unauthorized access):
1. **Immediate** (<5 min): Security Lead declares incident, activates war room
2. **Containment** (<15 min): Isolate affected systems (firewall block, disable endpoints)
3. **Assessment** (<1 hour): Determine blast radius (affected users, data exposed)
4. **Remediation** (<4 hours): Patch vulnerability, rotate credentials, deploy fix
5. **Notification** (<24 hours): Notify affected users, file breach report (GDPR requires 72 hours)
6. **Post-Mortem** (<72 hours): Root cause analysis, preventive measures

**P1 Service Outage** (API unavailable, database down):
1. **Immediate** (<5 min): On-call SRE declares incident
2. **Diagnosis** (<15 min): Check health endpoints, database connectivity, error logs
3. **Mitigation** (<30 min): Failover to standby database, rollback deployment, scale up replicas
4. **Recovery** (<1 hour): Service restored, verify functionality
5. **Post-Mortem** (<24 hours): Document RCA, preventive actions

**Communication Channels**:
- Internal: Slack #incidents (real-time updates every 15 min)
- External: Status page (https://status.company.com) + customer email (for P0/P1)

---

## Compliance & Regulatory

### GDPR (General Data Protection Regulation)

**Data Subject Rights**:
- **Right to access**: Provide user's message history via API (upstream implements endpoint)
- **Right to erasure**: Delete user's messages (soft delete with anonymization)
- **Right to portability**: Export messages in JSON format

**Implementation**:
```typescript
// Pseudonymization on deletion
async deleteUserMessages(userId: string) {
  await prisma.message.updateMany({
    where: { userId },
    data: {
      userId: 'DELETED', // Pseudonymize
      content: '[MESSAGE DELETED]', // Redact content
      deletedAt: new Date(),
    },
  });
}
```

**Data Retention**: Messages deleted after 2 years (configurable via `DATA_RETENTION_DAYS`)

### SOC 2 Type II

**Requirements**:
- Audit logging: All access to production database logged
- Change control: See CHANGE-CONTROL.md
- Encryption: At rest + in transit (documented above)
- Incident response: Procedures documented (see above)
- Access control: Principle of least privilege (database user has minimal permissions)

**Annual Audit**: External auditor reviews logs, policies, incident reports

---

## Security Testing

### Automated Testing

**In CI/CD** (every commit):
- `npm audit` - Dependency vulnerability scan (fail on HIGH/CRITICAL)
- `eslint` - Static code analysis (detect hardcoded secrets, unsafe patterns)
- Unit tests with security scenarios (injection attempts, XSS payloads)

**Weekly**:
- OWASP ZAP scan on staging environment (dynamic security testing)
- Container image scan (Trivy/Clair for known CVEs)

**Monthly**:
- Dependency updates (patch/minor versions)
- Review security alerts from GitHub/Snyk

### Manual Testing

**Quarterly**:
- Penetration testing by external firm (red team exercise)
- Code review of authentication bypass scenarios

**Ad-Hoc**:
- Security retrospectives after incidents
- Threat model updates after architecture changes

---

## Action Items

### Immediate (Before Production Launch)

- [ ] Deploy behind authenticated API gateway (CRITICAL)
- [ ] Enable TLS 1.3 for all connections
- [ ] Configure rate limiting per IP
- [ ] Set up PagerDuty alerts for security incidents
- [ ] Enable database encryption at rest (AWS RDS)
- [ ] Rotate gateway shared secret
- [ ] Test firewall rules (backend NOT accessible from internet)

### Short-Term (Within 30 Days)

- [ ] Implement anomaly detection rules
- [ ] Set up audit log retention (90 days)
- [ ] Configure SIEM integration (Splunk/ELK)
- [ ] Document incident response runbooks
- [ ] Train on-call team on security procedures

### Long-Term (Within 90 Days)

- [ ] Penetration testing engagement
- [ ] SOC 2 compliance readiness assessment
- [ ] Implement GDPR data export/deletion APIs
- [ ] Quarterly threat model review

---

## Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Security Lead | [Auto-approved] | TM-001 | 2025-10-20 |
| Tech Architect | [Auto-approved] | TM-001 | 2025-10-20 |
| Legal/Compliance | [Pending] | - | - |

**Next Review**: 2026-01-20 (Quarterly)  
**Version**: 1.0
