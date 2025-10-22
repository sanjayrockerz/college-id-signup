-- Database Performance Optimization - Index Design Migration
-- Generated: October 22, 2025
-- Purpose: Eliminate sequential scans and sorts on hot path queries
--
-- CRITICAL: Run EXPLAIN ANALYZE before and after to measure improvements
-- Expected improvements:
--   - Message history: 40-60% reduction in p95 latency
--   - Conversation list: 30-40% reduction in sort overhead
--   - Unread counter: Requires application-level denormalization
--
-- Safe to run in production: All indexes are CREATE INDEX CONCURRENTLY

-- =============================================================================
-- INDEX 1: Message History Query Optimization (CRITICAL PATH)
-- =============================================================================
-- Query: SELECT * FROM messages WHERE conversationId = ? ORDER BY createdAt DESC LIMIT 50
-- Current Issue: Likely using conversationId index then sorting in memory
-- Solution: Composite index matching WHERE + ORDER BY to eliminate sort
--
-- Benefits:
--   - Eliminates explicit sort operation
--   - Enables index-only scan for common queries
--   - Supports efficient pagination with cursor-based approach
--
-- Tradeoff:
--   - Insert overhead: ~5-10% slower message inserts (acceptable)
--   - Disk space: ~50-100MB for 10M messages
--   - Write amplification: 1 additional index update per message

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_conversation_created_desc
ON messages (
  "conversationId",
  "createdAt" DESC
)
WHERE "isDeleted" = false;  -- Partial index: exclude soft-deleted messages

-- Alternative: Consider INCLUDE for covering index if heap lookups are expensive
-- CREATE INDEX CONCURRENTLY idx_messages_conversation_created_covering
-- ON messages ("conversationId", "createdAt" DESC)
-- INCLUDE ("id", "senderId", "content", "type", "status");
-- Note: Uncomment if EXPLAIN ANALYZE shows high heap fetch overhead

-- Validation query (run after index creation):
-- EXPLAIN (ANALYZE, BUFFERS) 
-- SELECT id, content, "createdAt" FROM messages 
-- WHERE "conversationId" = 'sample-uuid' 
-- ORDER BY "createdAt" DESC LIMIT 50;
-- 
-- Expected plan: Index Scan using idx_messages_conversation_created_desc
-- Expected: NO "Sort" node in plan

-- =============================================================================
-- INDEX 2: Conversation List Query Optimization (HIGH FREQUENCY)
-- =============================================================================
-- Query: SELECT * FROM conversations WHERE id IN (...) ORDER BY updatedAt DESC
-- Current Status: conversations.updatedAt index already exists (✅)
-- Additional optimization: conversation_users join performance

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversation_users_user_active_conv
ON conversation_users (
  "userId",
  "isActive"
)
INCLUDE ("conversationId", "lastReadAt", "role");

-- This covering index eliminates heap lookups for the join in getUserConversations()
-- Benefits:
--   - Faster filtering by userId + isActive
--   - Includes lastReadAt for unread calculation
--   - Supports index-only scan for common queries

-- =============================================================================
-- INDEX 3: Message Reads - Optimize Unread Lookups
-- =============================================================================
-- Query: SELECT 1 FROM message_reads WHERE messageId IN (...) AND userId = ?
-- Current Status: Unique constraint (userId, messageId) provides index
-- Additional optimization: Reverse lookup for batch operations

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_message_reads_message_user
ON message_reads ("messageId", "userId")
WHERE "readAt" > NOW() - INTERVAL '30 days';  -- Partial: recent reads only

-- Benefits:
--   - Optimizes lookup by messageId first (for read receipt queries)
--   - Partial index reduces size and maintenance overhead
--   - Complement to existing (userId, messageId) unique index

-- =============================================================================
-- INDEX 4: Messages - Sender Lookup Optimization
-- =============================================================================
-- Query: Used for "messages sent by user" and fanout queries
-- Current Status: messages(senderId) index exists
-- Additional: Composite for sender + conversation lookups

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_sender_created
ON messages ("senderId", "createdAt" DESC)
WHERE "isDeleted" = false;

-- Benefits:
--   - Optimizes "user's recent messages" queries
--   - Supports efficient ordering by time per sender
--   - Partial index excludes soft-deleted messages

-- =============================================================================
-- INDEX 5: Presence Lookup - Online Status Query
-- =============================================================================
-- Current Status: users(isOnline, lastSeenAt) index already exists (✅)
-- No additional index needed - primary key lookup is already optimal

-- =============================================================================
-- INDEX 6: Participant Verification - Security Path
-- =============================================================================
-- Current Status: conversation_users unique(userId, conversationId) exists (✅)
-- Alternative index for conversationId-first lookups:

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversation_users_conv_active_user
ON conversation_users (
  "conversationId",
  "isActive",
  "userId"
);

-- Benefits:
--   - Optimizes "list all participants in conversation" queries
--   - Supports efficient filtering by isActive
--   - Complement to existing (userId, conversationId) unique index

-- =============================================================================
-- INDEX 7: Thread/Reply Optimization
-- =============================================================================
-- Query: SELECT * FROM messages WHERE threadId = ? OR replyToId = ?
-- Current Status: Individual indexes exist
-- Optimization: For thread-based chat features

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_thread_created
ON messages ("threadId", "createdAt" DESC)
WHERE "threadId" IS NOT NULL AND "isDeleted" = false;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_reply_to
ON messages ("replyToId")
WHERE "replyToId" IS NOT NULL AND "isDeleted" = false;

-- Benefits:
--   - Optimizes thread view queries
--   - Partial indexes reduce overhead (only threaded messages)
--   - Supports efficient pagination within threads

-- =============================================================================
-- MONITORING: Create statistics for query optimization
-- =============================================================================
-- Ensure PostgreSQL has accurate statistics for query planning

ANALYZE messages;
ANALYZE conversations;
ANALYZE conversation_users;
ANALYZE message_reads;
ANALYZE users;

-- =============================================================================
-- VALIDATION QUERIES
-- =============================================================================
-- Run these after index creation to verify improvements:

-- 1. Message History - Should use idx_messages_conversation_created_desc
-- EXPLAIN (ANALYZE, BUFFERS) 
-- SELECT * FROM messages 
-- WHERE "conversationId" = 'sample-uuid' 
-- ORDER BY "createdAt" DESC LIMIT 50;

-- 2. Conversation List - Should use idx_conversation_users_user_active_conv
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT c.* FROM conversations c
-- INNER JOIN conversation_users cu ON cu."conversationId" = c.id
-- WHERE cu."userId" = 'sample-uuid' AND cu."isActive" = true
-- ORDER BY c."updatedAt" DESC LIMIT 20;

-- 3. Participant Check - Should use idx_conversation_users_conv_active_user or unique constraint
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT 1 FROM conversation_users
-- WHERE "conversationId" = 'sample-uuid' AND "userId" = 'sample-uuid' AND "isActive" = true;

-- =============================================================================
-- INDEX SIZE MONITORING
-- =============================================================================
-- Monitor index sizes and usage over time

CREATE OR REPLACE VIEW vw_index_usage AS
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan as scans,
  idx_tup_read as tuples_read,
  idx_tup_fetch as tuples_fetched,
  pg_size_pretty(pg_relation_size(indexrelid)) as size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;

-- Usage: SELECT * FROM vw_index_usage WHERE tablename IN ('messages', 'conversations', 'conversation_users');

-- =============================================================================
-- ROLLBACK SCRIPT (if needed)
-- =============================================================================
-- Keep for reference - only run if indexes cause unexpected issues

-- DROP INDEX CONCURRENTLY IF EXISTS idx_messages_conversation_created_desc;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_conversation_users_user_active_conv;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_message_reads_message_user;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_messages_sender_created;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_conversation_users_conv_active_user;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_messages_thread_created;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_messages_reply_to;

-- =============================================================================
-- PERFORMANCE IMPACT EXPECTATIONS
-- =============================================================================
--
-- Query Type              | Current p95 | Target p95 | Expected Improvement
-- ----------------------- | ----------- | ---------- | --------------------
-- Message History         | 24ms        | <15ms      | 40-60%
-- Conversation List       | 40-60ms     | <30ms      | 30-40%
-- Participant Check       | 5ms         | <2ms       | 50-60%
-- Message Insert          | 15-20ms     | 20-25ms    | -15% (tradeoff)
-- Thread View             | Variable    | <20ms      | 50-70%
--
-- Overall Impact:
--   - Read queries: 40-60% faster on average
--   - Write queries: 10-15% slower (acceptable for read-heavy workload)
--   - Disk usage: +150-250MB (< 1% of total DB size)
--   - Index maintenance: Minimal overhead with autovacuum

-- =============================================================================
-- POST-DEPLOYMENT MONITORING
-- =============================================================================
-- Monitor these metrics for 24-48 hours after deployment:
--
-- 1. Query performance (via application metrics):
--    - Message history p50, p95, p99
--    - Conversation list p50, p95, p99
--    - Cache hit ratios (should remain stable)
--
-- 2. Database metrics:
--    - Index scan counts (should increase)
--    - Sequential scan counts (should decrease)
--    - Sort operations (should decrease)
--    - Buffer cache hit ratio (should remain > 99%)
--
-- 3. Write performance:
--    - Message insert latency (acceptable if < 30ms p95)
--    - Index bloat (monitor with pg_stat_user_indexes)
--    - Autovacuum frequency (should remain stable)

-- =============================================================================
-- NEXT STEPS: Application-Level Optimization
-- =============================================================================
-- 
-- CRITICAL: Unread counter optimization requires denormalization
-- 
-- The unread counter query (NOT EXISTS anti-join) cannot be efficiently
-- optimized with indexes alone. Recommended approach:
--
-- 1. Add column: conversation_users.unreadCount INTEGER DEFAULT 0
-- 2. Increment on message insert (if sender != userId)
-- 3. Decrement on markMessagesAsRead
-- 4. Rebuild counts: UPDATE conversation_users SET unreadCount = (SELECT COUNT...)
-- 5. Add background job to reconcile counts daily
--
-- Expected improvement: 80-90% reduction in unread counter query time
-- Implementation: Requires schema migration + application logic changes
--
-- See: scripts/performance/db-baseline/03-denormalize-unread-counts.sql
