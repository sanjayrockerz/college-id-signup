# Database Query Catalog - Hot Paths Analysis

## Overview

This document catalogs the highest-traffic queries in the chat application based on Phase 1 concurrent fanout and presence implementation. Each query is documented with its shape, parameters, frequency, and current performance characteristics.

---

## 1. Message History Query (READ - CRITICAL PATH)

### Query Shape

```sql
-- Repository: ChatRepository.getMessages()
-- File: src/chat-backend/repositories/chat.repository.ts:264-329

SELECT
  m.id, m.content, m.type, m.status, m.isEdited, m.editedAt,
  m.isDeleted, m.deletedAt, m.replyToId, m.threadId, m.metadata,
  m.createdAt, m.updatedAt, m.senderId, m.conversationId,
  -- sender fields
  s.id as sender_id, s.username, s.firstName, s.lastName, s.profileImageUrl,
  -- attachments (array)
  -- messageReads (array with user info)
FROM messages m
INNER JOIN users s ON m.senderId = s.id
LEFT JOIN attachments a ON a.messageId = m.id
LEFT JOIN message_reads mr ON mr.messageId = m.id
LEFT JOIN users mru ON mr.userId = mru.id
WHERE m.conversationId = $1
  AND m.createdAt < $2  -- cursor-based pagination
ORDER BY m.createdAt DESC
LIMIT $3 + 1;  -- limit + 1 for hasMore detection
```

### Parameters

- `$1` (conversationId): UUID, indexed FK
- `$2` (cursor): TIMESTAMP, pagination cursor (optional, defaults to NOW())
- `$3` (limit): INTEGER, typically 20-100, default 50

### Access Pattern

- **Frequency**: VERY HIGH - 70% of all chat API calls
- **User Pattern**: Every conversation open, scroll up = new query
- **Cache Strategy**: 30s TTL for recent (offset=0), 60s for older
- **Expected QPS**: 500-1000 req/s under load (per Phase 1 projections)

### Current Performance Characteristics

- **Cache Hit**: ~14ms (42% improvement - FAST PATH)
- **Cache Miss**: ~24ms (measured manually, needs EXPLAIN ANALYZE)
- **Expected Index**: `messages(conversationId, createdAt DESC)` - **MISSING**
- **Risk**: Sequential scan or explicit sort on cache miss

### Optimization Hypothesis

- Composite index will eliminate sort node
- Expected improvement: 40-60% on cache miss path
- Target: <15ms p95 on cache miss, <10ms p50

---

## 2. Message Insert (WRITE - CRITICAL PATH)

### Query Shape

```sql
-- Repository: ChatRepository.sendMessage()
-- File: src/chat-backend/repositories/chat.repository.ts:195-262

BEGIN;

-- Insert message
INSERT INTO messages (
  id, conversationId, senderId, content, type, status,
  isEdited, isDeleted, replyToId, threadId, metadata,
  createdAt, updatedAt
)
VALUES (
  gen_random_uuid(), $1, $2, $3, $4, 'SENT',
  false, false, $5, $6, $7,
  NOW(), NOW()
)
RETURNING *;

-- Update conversation lastMessageAt
UPDATE conversations
SET lastMessageAt = NOW(),
    lastMessageId = $messageId,
    updatedAt = NOW()
WHERE id = $1;

-- Update sender's lastReadAt
UPDATE conversation_users
SET lastReadAt = NOW(), updatedAt = NOW()
WHERE conversationId = $1 AND userId = $2;

COMMIT;
```

### Parameters

- `$1` (conversationId): UUID
- `$2` (senderId): UUID
- `$3` (content): TEXT, up to 10KB
- `$4` (type): ENUM, typically 'TEXT'
- `$5` (replyToId): UUID | NULL
- `$6` (threadId): UUID | NULL
- `$7` (metadata): JSONB | NULL

### Access Pattern

- **Frequency**: HIGH - 30% of chat operations
- **User Pattern**: Every message sent triggers write + cache invalidation
- **Fanout**: 1 insert + 2 updates + N cache invalidations (N = participants)
- **Expected QPS**: 200-500 req/s under load

### Current Performance Characteristics

- **Measured**: Not yet captured
- **Expected**: <20ms p50, <40ms p95
- **Cache Impact**: Invalidates pattern `msg:history:${conversationId}:*`
- **Lock Contention**: Possible on conversation update (hot row)

### Optimization Hypothesis

- Index on `messages(conversationId)` exists for FK
- Index on `messages(senderId)` exists
- Possible optimization: Partial index on non-deleted messages
- Watch for: conversation row update lock contention

---

## 3. Read Receipt Update (WRITE - MEDIUM FREQUENCY)

### Query Shape

```sql
-- Repository: ChatRepository.markMessagesAsRead()
-- File: src/chat-backend/repositories/chat.repository.ts:341-385

BEGIN;

-- Check existing read receipts
SELECT messageId
FROM message_reads
WHERE messageId = ANY($1::uuid[])
  AND userId = $2;

-- Bulk insert new read receipts
INSERT INTO message_reads (id, messageId, userId, readAt, createdAt, updatedAt)
SELECT
  gen_random_uuid(),
  unnest($unreadMessageIds::uuid[]),
  $2,
  NOW(),
  NOW(),
  NOW()
ON CONFLICT (userId, messageId) DO NOTHING;

COMMIT;
```

### Parameters

- `$1` (messageIds): UUID[], typically 1-50 message IDs
- `$2` (userId): UUID

### Access Pattern

- **Frequency**: MEDIUM - Triggered on scroll or conversation view
- **User Pattern**: Batch updates every 2-5 seconds while viewing
- **Fanout**: 1 read + 1 bulk insert per user action
- **Expected QPS**: 100-200 req/s under load

### Current Performance Characteristics

- **Measured**: Not yet captured
- **Expected**: <15ms p50, <30ms p95
- **Index Needed**: `message_reads(userId, messageId)` - UNIQUE constraint exists
- **Bulk Operations**: Uses `createMany()` for efficiency

### Optimization Hypothesis

- Unique constraint provides index automatically
- Possible optimization: Partial index on recent reads (7-30 days)
- Watch for: Lock contention on high-frequency readers

---

## 4. Conversation List Query (READ - HIGH FREQUENCY)

### Query Shape

```sql
-- Repository: ChatRepository.getUserConversations()
-- File: src/chat-backend/repositories/chat.repository.ts:105-174

SELECT
  c.id, c.name, c.description, c.type, c.avatarUrl, c.isActive,
  c.allowMemberAdd, c.allowFileSharing, c.maxMembers,
  c.lastMessageAt, c.lastMessageId, c.createdAt, c.updatedAt, c.creatorId,
  -- participants with user info
  -- last message with sender info and attachments
  -- counts (messages, participants)
FROM conversations c
INNER JOIN conversation_users cu ON cu.conversationId = c.id
WHERE cu.userId = $1
  AND c.updatedAt < $2  -- cursor for pagination
ORDER BY c.updatedAt DESC
LIMIT $3 + 1;
```

### Parameters

- `$1` (userId): UUID
- `$2` (cursor): TIMESTAMP, pagination cursor (optional)
- `$3` (limit): INTEGER, typically 20-50, default 20

### Access Pattern

- **Frequency**: HIGH - Every app open, pull to refresh
- **User Pattern**: Conversation list is primary view
- **Prefetch**: Often queries last message and unread count per conversation
- **Expected QPS**: 300-600 req/s under load

### Current Performance Characteristics

- **Measured**: Not yet captured
- **Expected**: <30ms p50, <60ms p95
- **Index Available**: `conversations(updatedAt)` ✅ EXISTS (schema.prisma:239)
- **Complex Join**: Includes participants, last message, counts

### Optimization Hypothesis

- `conversations(updatedAt)` index should prevent sort
- Possible optimization: Denormalize unread count to conversation_users
- Watch for: N+1 queries on participants and last message

---

## 5. Unread Counter Query (READ - VERY HIGH FREQUENCY)

### Query Shape

```sql
-- Repository: ChatRepository.getUnreadMessageCount()
-- File: src/chat-backend/repositories/chat.repository.ts:380-407

-- Get user's conversations
SELECT conversationId
FROM conversation_users
WHERE userId = $1;

-- Count unread messages across all conversations
SELECT COUNT(*) as unread_count
FROM messages m
WHERE m.conversationId = ANY($conversationIds)
  AND m.senderId != $1  -- Exclude own messages
  AND NOT EXISTS (
    SELECT 1 FROM message_reads mr
    WHERE mr.messageId = m.id AND mr.userId = $1
  );
```

### Parameters

- `$1` (userId): UUID

### Access Pattern

- **Frequency**: VERY HIGH - Polled every 5-10s, every tab focus
- **User Pattern**: Badge counter, conversation list unread indicators
- **Fanout**: 1 query per user, but very frequent
- **Expected QPS**: 1000-2000 req/s under load

### Current Performance Characteristics

- **Measured**: Not yet captured
- **Expected**: Variable, depends on # of conversations and messages
- **Inefficiency**: Anti-join pattern with NOT EXISTS is expensive
- **Risk**: This is likely the #1 performance bottleneck

### Optimization Hypothesis

- **Critical**: Denormalize unread count to `conversation_users.unreadCount`
- Update on message insert, decrement on read
- Expected improvement: 80-90% reduction in query time
- Alternative: Materialized view or cached counters

---

## 6. Presence Lookup Query (READ - REAL-TIME PATH)

### Query Shape

```sql
-- Used by real-time presence system
-- File: src/user/user.service.ts or socket handlers

SELECT id, username, isOnline, lastSeenAt, typingIn
FROM users
WHERE id = ANY($1::uuid[]);  -- Batch lookup
```

### Parameters

- `$1` (userIds): UUID[], typically 5-50 user IDs per conversation

### Access Pattern

- **Frequency**: VERY HIGH - Every conversation view, websocket connection
- **User Pattern**: Real-time status updates, typing indicators
- **Fanout**: 1 query per conversation view, plus polling/socket updates
- **Expected QPS**: 500-1000 req/s under load

### Current Performance Characteristics

- **Measured**: Not yet captured
- **Expected**: <5ms p50, <10ms p95 (simple index lookup)
- **Index Available**: `users(id)` PRIMARY KEY ✅
- **Secondary Index**: `users(isOnline, lastSeenAt)` ✅ EXISTS (schema.prisma:50)

### Optimization Hypothesis

- Primary key lookup is already optimal
- Consider Redis cache for online status (TTL 10-30s)
- Watch for: High polling frequency overwhelming DB

---

## 7. Conversation Participant Verification (READ - SECURITY PATH)

### Query Shape

```sql
-- Repository: ChatRepository.getMessages() and others
-- Access control check before operations

SELECT 1
FROM conversation_users cu
WHERE cu.conversationId = $1
  AND cu.userId = $2
  AND cu.isActive = true
LIMIT 1;
```

### Parameters

- `$1` (conversationId): UUID
- `$2` (userId): UUID

### Access Pattern

- **Frequency**: VERY HIGH - Every message query, send, read operation
- **User Pattern**: Security gate for all chat operations
- **Caching**: Not currently cached (security-critical)
- **Expected QPS**: 1500-2500 req/s under load (all operations)

### Current Performance Characteristics

- **Measured**: Not yet captured
- **Expected**: <2ms p50, <5ms p95 (index lookup)
- **Index Available**: `conversation_users(userId, conversationId)` UNIQUE ✅
- **Alternative Index**: `conversation_users(conversationId, isActive)` ✅

### Optimization Hypothesis

- Unique constraint provides optimal index
- Consider: Short-lived cache (5-10s) for high-frequency checks
- Watch for: Index bloat from soft deletes (isActive = false)

---

## Query Frequency Summary

| Query                 | Frequency | Cache Strategy            | Target p95 | Risk Level   |
| --------------------- | --------- | ------------------------- | ---------- | ------------ |
| **Message History**   | 70%       | Redis 30-60s              | <15ms      | HIGH         |
| **Message Insert**    | 30%       | Cache invalidation        | <40ms      | MEDIUM       |
| **Read Receipt**      | 15%       | Not cached                | <30ms      | LOW          |
| **Conversation List** | 20%       | Could cache 10-20s        | <60ms      | MEDIUM       |
| **Unread Counter**    | POLLING   | **Needs denormalization** | <10ms      | **CRITICAL** |
| **Presence Lookup**   | POLLING   | Redis 10-30s              | <10ms      | HIGH         |
| **Participant Check** | 100%      | Short-lived 5-10s         | <5ms       | MEDIUM       |

---

## Data Volume Assumptions

### Current Scale (Phase 1 Target)

- **Active Users**: 5,000-10,000 concurrent
- **Conversations**: ~50,000 total
- **Messages**: ~10M total, growing 500K/day
- **Participants**: ~200K conversation_users rows
- **Message Reads**: ~50M total (high cardinality)

### Query Impact by Volume

1. **Message History**: Limited by conversationId + limit (50-100 rows)
2. **Conversation List**: Limited by userId + limit (20-50 rows)
3. **Unread Counter**: **Grows with messages** - O(messages × conversations)
4. **Participant Check**: Fixed cost (1 row lookup)

---

## Next Steps

1. ✅ **Query Catalog Complete** - All hot paths identified
2. ⏳ **EXPLAIN ANALYZE Capture** - Run with representative data
3. ⏳ **Baseline Report** - Document current performance
4. ⏳ **Index Design** - Create migration scripts
5. ⏳ **Validation** - Measure before/after improvements

---

**Generated**: October 22, 2025  
**Status**: Task 1 Complete - Ready for EXPLAIN ANALYZE baseline capture  
**Critical Finding**: Unread counter query is likely the #1 bottleneck requiring denormalization
