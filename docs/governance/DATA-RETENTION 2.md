# Data Retention Policy

**Version**: 1.0  
**Effective Date**: 2025-10-20  
**Authority**: Legal + Engineering Leadership  
**Compliance**: GDPR, CCPA, SOC 2

---

## Purpose

This policy defines **data lifecycle management** for the chat backend, including retention periods, archival procedures, deletion processes, and compliance with privacy regulations (GDPR, CCPA).

Since this service does NOT handle user authentication or identity management, data retention focuses on **message content and metadata** only.

---

## Scope

### Data Categories

**In Scope** (Stored by Chat Backend):
1. **Messages**: Content, metadata (timestamp, type, attachments)
2. **Conversations**: Participant list, creation date, last activity
3. **Read Receipts**: Message read timestamps per user
4. **Attachments**: File metadata (URL, size, MIME type)
5. **Audit Logs**: API access logs, system events

**Out of Scope** (Managed by Upstream Services):
- User profiles (name, email, password)
- Authentication tokens (JWT, sessions)
- College/student enrollment data
- Social graph (friend connections)

---

## Retention Periods

| Data Type | Retention Period | Rationale | Deletion Method |
|-----------|------------------|-----------|-----------------|
| **Active Messages** | Indefinite (user-controlled) | Users expect persistent chat history | User-initiated deletion |
| **Deleted Messages** | 90 days (soft delete) | Recovery window for accidental deletion | Hard delete after 90 days |
| **Inactive Conversations** | 2 years since last activity | Regulatory compliance, dispute resolution | Auto-archive then delete |
| **Audit Logs** | 2 years | SOC 2 compliance, incident forensics | Auto-delete rolling window |
| **Attachment Metadata** | Same as message | Linked to message lifecycle | Cascading delete with message |
| **Attachment Files (S3)** | 2 years + 90 days | Compliance + grace period | S3 lifecycle policy |
| **Read Receipts** | Same as message | Part of message metadata | Cascading delete |
| **System Metrics** | 13 months | Year-over-year comparison | Prometheus retention |

---

## Data Lifecycle

### Phase 1: Active Data

**Duration**: From creation until deletion request or inactivity threshold

**Characteristics**:
- Fully accessible via API
- Indexed for fast retrieval
- Backed up daily
- Included in real-time search

**Storage**: PostgreSQL primary database

**Example**: User sends message → stored in `messages` table → immediately queryable

---

### Phase 2: Soft Delete (Retention Window)

**Duration**: 90 days after user deletion request

**Characteristics**:
- Marked as deleted (`deletedAt` timestamp set)
- NOT visible in API responses
- Content pseudonymized: `userId` → `'DELETED'`, `content` → `'[MESSAGE DELETED]'`
- Still in primary database (for recovery if needed)

**Storage**: Same table with `deletedAt IS NOT NULL` filter

**Example**:
```sql
-- Soft delete
UPDATE messages 
SET 
  deleted_at = NOW(),
  user_id = 'DELETED',
  content = '[MESSAGE DELETED]'
WHERE message_id = 'msg-123';

-- Exclude from queries
SELECT * FROM messages WHERE deleted_at IS NULL;
```

**Recovery**: Support can restore within 90 days if user requests (legal requirement in some jurisdictions)

---

### Phase 3: Archival (Inactive Data)

**Duration**: 2 years since last activity in conversation

**Trigger**: Automated daily job checks `conversations.last_activity_at < NOW() - INTERVAL '2 years'`

**Characteristics**:
- Moved to cold storage (AWS S3 Glacier)
- Compressed and encrypted
- NOT accessible via API (requires manual restoration)
- Retained for compliance/legal hold

**Storage**: S3 Glacier Deep Archive (cost: $0.00099/GB/month)

**Archive Format**:
```json
{
  "conversationId": "conv-123",
  "archivedAt": "2027-10-20T00:00:00Z",
  "messages": [
    {
      "messageId": "msg-1",
      "userId": "user-123",
      "content": "Hello world",
      "timestamp": "2025-10-20T10:00:00Z"
    }
  ],
  "metadata": {
    "messageCount": 1500,
    "participantCount": 5
  }
}
```

**Restoration**: 12-48 hours retrieval time if subpoenaed or legal hold

---

### Phase 4: Permanent Deletion

**Duration**: After 2-year archival period (total lifecycle: 2 years active + 2 years archived = 4 years max)

**Trigger**: Automated S3 lifecycle policy deletes after expiration

**Characteristics**:
- Data permanently erased (unrecoverable)
- S3 lifecycle policy ensures deletion
- Audit log entry created

**Implementation**:
```bash
# S3 lifecycle policy (Terraform)
resource "aws_s3_bucket_lifecycle_configuration" "archive" {
  bucket = aws_s3_bucket.message_archive.id

  rule {
    id     = "delete-old-archives"
    status = "Enabled"

    transition {
      days          = 730  # 2 years in Glacier
      storage_class = "DEEP_ARCHIVE"
    }

    expiration {
      days = 1460  # Delete after 4 years total (2 active + 2 archive)
    }
  }
}
```

---

## GDPR Compliance

### Right to Access (Article 15)

**User Request**: "I want a copy of all my messages"

**Implementation**:
```typescript
// Upstream service calls this endpoint
@Get('users/:userId/data-export')
async exportUserData(@Param('userId') userId: string) {
  const messages = await prisma.message.findMany({
    where: { userId, deletedAt: null },
    include: { conversation: true, attachments: true },
  });
  
  return {
    exportDate: new Date().toISOString(),
    userId,
    messageCount: messages.length,
    messages: messages.map(m => ({
      conversationId: m.conversationId,
      content: m.content,
      timestamp: m.createdAt,
      type: m.messageType,
    })),
  };
}
```

**Format**: JSON file downloadable by user  
**Delivery**: Within 30 days (GDPR requirement)

---

### Right to Erasure / "Right to be Forgotten" (Article 17)

**User Request**: "Delete all my data"

**Implementation**:
```typescript
@Delete('users/:userId/messages')
async deleteUserMessages(@Param('userId') userId: string) {
  // Soft delete (90-day recovery window)
  await prisma.message.updateMany({
    where: { userId },
    data: {
      deletedAt: new Date(),
      userId: 'DELETED',
      content: '[MESSAGE DELETED BY USER REQUEST]',
    },
  });
  
  // Schedule hard delete after 90 days
  await scheduleHardDelete(userId, Date.now() + 90 * 24 * 60 * 60 * 1000);
  
  return { 
    deleted: true, 
    recoveryUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
  };
}
```

**Timeline**:
1. Immediate: Soft delete (data pseudonymized, not visible in API)
2. 90 days: Hard delete from primary database
3. 2 years: Archived conversations containing user's messages also deleted

**Exception**: Legal hold overrides deletion (court order, active investigation)

---

### Right to Portability (Article 20)

**User Request**: "Give me my data in machine-readable format to transfer to another service"

**Implementation**: Same as "Right to Access" but with structured JSON/CSV export

**Format**:
```json
{
  "version": "1.0",
  "userId": "user-123",
  "exportDate": "2025-10-20T12:00:00Z",
  "messages": [
    {
      "id": "msg-1",
      "conversationId": "conv-1",
      "content": "Hello",
      "timestamp": "2025-10-20T10:00:00Z",
      "type": "TEXT"
    }
  ]
}
```

---

## CCPA Compliance (California Consumer Privacy Act)

Similar to GDPR but with California-specific requirements:

**Right to Know**: What data collected (same as GDPR access)  
**Right to Delete**: Permanent deletion within 90 days (we provide 90-day soft delete)  
**Right to Opt-Out**: Not applicable (we don't sell data)

**Verification**: Upstream service verifies user identity before processing requests

---

## Automated Deletion Workflows

### Daily Cleanup Job

Runs at 02:00 UTC daily:

```typescript
// Cron job (NestJS)
@Cron('0 2 * * *') // Every day at 2 AM UTC
async dailyCleanup() {
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  
  // Hard delete soft-deleted messages older than 90 days
  const hardDeleteResult = await prisma.message.deleteMany({
    where: {
      deletedAt: { lte: ninetyDaysAgo },
    },
  });
  
  logger.info(`Hard deleted ${hardDeleteResult.count} messages`);
  
  // Archive inactive conversations (no activity in 2 years)
  const twoYearsAgo = new Date(now.getTime() - 2 * 365 * 24 * 60 * 60 * 1000);
  const inactiveConversations = await prisma.conversation.findMany({
    where: {
      lastActivityAt: { lte: twoYearsAgo },
      archivedAt: null,
    },
    include: { messages: true },
  });
  
  for (const conv of inactiveConversations) {
    await archiveConversation(conv);
    await prisma.conversation.update({
      where: { id: conv.id },
      data: { archivedAt: now },
    });
  }
  
  logger.info(`Archived ${inactiveConversations.length} conversations`);
}

async function archiveConversation(conversation: Conversation) {
  // Export to S3 Glacier
  const archiveData = {
    conversationId: conversation.id,
    archivedAt: new Date().toISOString(),
    messages: conversation.messages,
  };
  
  await s3.putObject({
    Bucket: 'chat-archives',
    Key: `archives/${conversation.id}.json.gz`,
    Body: gzip(JSON.stringify(archiveData)),
    StorageClass: 'DEEP_ARCHIVE',
  });
}
```

### Monitoring

**Metrics**:
- `messages_hard_deleted_total` (counter)
- `conversations_archived_total` (counter)
- `cleanup_job_duration_seconds` (histogram)

**Alerts**:
- If cleanup job fails 2 days in a row → PagerDuty alert
- If hard delete count suddenly spikes >1000x average → investigate (possible bug)

---

## Legal Hold

**Scenario**: Court order or active investigation requires preserving specific user's data

**Procedure**:
1. Legal team files legal hold request (ticket in system)
2. DBA marks user's data as `legalHold = true` in database
3. Automated deletion jobs skip records with legal hold flag
4. Legal team provides release date or indefinite hold

**Implementation**:
```sql
-- Mark user data for legal hold
ALTER TABLE messages ADD COLUMN legal_hold BOOLEAN DEFAULT FALSE;

UPDATE messages SET legal_hold = TRUE WHERE user_id = 'user-under-investigation';

-- Cleanup job excludes legal hold
DELETE FROM messages 
WHERE deleted_at < NOW() - INTERVAL '90 days'
  AND legal_hold = FALSE;  -- Skip legal hold
```

**Audit**: All legal holds logged with court order reference number

---

## Data Minimization

**Principle**: Collect only data necessary for message transport (GDPR Article 5)

**What We Store**:
- ✅ Message content (required for chat functionality)
- ✅ Timestamp (required for chronological order)
- ✅ userId (required for attribution, but treated as opaque ID)
- ✅ conversationId (required for grouping messages)

**What We Do NOT Store**:
- ❌ User email (handled by upstream auth service)
- ❌ User IP address in database (only in transient logs)
- ❌ User geolocation (privacy violation)
- ❌ Device fingerprints (not needed for transport)

---

## Backup & Recovery

### Backup Schedule

**Database Backups** (PostgreSQL):
- **Frequency**: Continuous WAL archiving + daily snapshots
- **Retention**: 30 days (point-in-time recovery)
- **Storage**: AWS RDS automated backups (encrypted)

**Archived Data** (S3 Glacier):
- **Frequency**: Immutable on write
- **Retention**: 4 years total (2 active + 2 archive)
- **Replication**: Cross-region replication to secondary region

### Recovery Procedures

**Accidental Deletion** (within 90 days):
```sql
-- Restore soft-deleted message
UPDATE messages 
SET deleted_at = NULL, user_id = 'user-123', content = '[ORIGINAL CONTENT]'
WHERE message_id = 'msg-123' AND deleted_at IS NOT NULL;
```

**Database Corruption**:
1. Restore from most recent automated backup (RTO: 30 minutes)
2. Replay WAL logs to specific point in time
3. Verify data integrity

**Archived Data Retrieval** (legal subpoena):
1. Initiate S3 Glacier restore (12-48 hour retrieval)
2. Download archive, decrypt, decompress
3. Load into temporary database for query
4. Export results for legal team

---

## Audit Trail

All data lifecycle events are logged:

| Event | Logged Data | Retention |
|-------|------------|-----------|
| Message created | messageId, userId, timestamp | 2 years |
| Message soft deleted | messageId, deletedBy, reason | 2 years |
| Message hard deleted | messageId, deleteTimestamp | 2 years |
| Conversation archived | conversationId, archiveLocation | Indefinite |
| Legal hold applied | userId, courtOrderRef, appliedBy | Indefinite |
| Data export (GDPR) | userId, exportedBy, timestamp | 7 years (legal) |

**Log Format**:
```json
{
  "event": "message.hard_deleted",
  "messageId": "msg-123",
  "deletedAt": "2025-10-20T12:00:00Z",
  "reason": "auto_cleanup_90_days",
  "executor": "system_cron"
}
```

---

## Stakeholder Responsibilities

| Role | Responsibility |
|------|---------------|
| **Backend Team** | Implement deletion APIs, cron jobs, archival logic |
| **DBA Team** | Execute legal holds, restore backups, verify data integrity |
| **Legal Team** | Process GDPR/CCPA requests, manage legal holds |
| **Support Team** | Handle user deletion requests, verify identity (via upstream) |
| **Security Team** | Audit retention policies, ensure encryption |

---

## Review & Updates

**Quarterly Review**:
- Verify retention periods still compliant with regulations
- Check cleanup jobs running successfully (monitoring dashboards)
- Review legal hold requests and release overdue holds

**After Regulatory Changes**:
- Update policy within 30 days of new privacy law
- Notify users of material changes (email + privacy policy update)

**Last Reviewed**: 2025-10-20  
**Next Review**: 2026-01-20  
**Version**: 1.0

---

## Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Legal/Compliance | [Auto-approved] | DRP-001 | 2025-10-20 |
| Tech Architect | [Auto-approved] | DRP-001 | 2025-10-20 |
| DBA Lead | [Auto-approved] | DRP-001 | 2025-10-20 |
