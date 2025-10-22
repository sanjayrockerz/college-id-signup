-- Phase 2 Composite Indexes
-- Database Performance Optimization

-- Prerequisites:
-- 1. Synthetic dataset loaded and validated (fidelity check PASSED)
-- 2. Database statistics up-to-date (ANALYZE run)
-- 3. Sufficient disk space for index creation (~30% of table size)

-- Safety: All indexes use CONCURRENTLY to avoid blocking writes

BEGIN;

-- Index 1: Message History Queries
-- Purpose: Eliminate Sort node on message history queries (ORDER BY createdAt DESC)
-- Impact: Q1 (Message History) - Expected 60-70% latency reduction
-- Tradeoff: ~15% write overhead on INSERT, 2GB additional disk per 100M messages

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_conversation_created_desc
  ON messages ("conversationId", "createdAt" DESC);

-- Rationale:
-- - Supports WHERE conversationId = ? ORDER BY createdAt DESC LIMIT N
-- - Composite (conversationId, createdAt DESC) allows backward index scan
-- - DESC matches query ORDER BY direction (critical for Sort elimination)
-- - Most common read path (50k req/min in production)

-- Index 2: Conversation List for User
-- Purpose: Fast lookup of user's active conversations with covering scan
-- Impact: Q3 (Conversation List) - Expected 50-60% latency reduction
-- Tradeoff: ~10% write overhead on membership changes, INCLUDE adds 500MB

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversation_users_user_active
  ON conversation_users ("userId", "isActive")
  INCLUDE ("conversationId");

-- Rationale:
-- - Supports WHERE userId = ? AND isActive = true
-- - INCLUDE (conversationId) makes it covering (no heap lookups for JOIN)
-- - High selectivity: typical user has 20-50 conversations
-- - Reduces buffer reads by 60% (avoids heap access)

-- Index 3: Recent Conversation Ordering
-- Purpose: Fast ORDER BY updatedAt DESC for conversation list
-- Impact: Q3 (Conversation List) - Complements index #2
-- Tradeoff: ~5% write overhead on conversation updates, 800MB additional

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_updated_desc
  ON conversations ("updatedAt" DESC);

-- Rationale:
-- - Supports ORDER BY updatedAt DESC in conversation list
-- - DESC matches query ordering
-- - Updated on every message send (hot write path)
-- - Consider partial index if most conversations are inactive

-- Index 4: Message Reads Lookup (Optional - evaluate if needed)
-- Purpose: Fast unread count calculation
-- Impact: Q4 (Unread Count) - Only if denormalization rejected
-- Note: Denormalizing lastReadAt into conversation_users is preferred

-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_message_reads_user_message
--   ON message_reads ("userId", "messageId");

-- Rationale:
-- - Only create if NOT denormalizing read state
-- - Better: Add lastReadAt to conversation_users, update on read receipt
-- - Reduces unread count query to simple comparison

COMMIT;

-- Verification Commands
-- Run after index creation completes

-- 1. Check index creation status
SELECT
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size,
  idx_scan as index_scans,
  idx_tup_read as tuples_read,
  idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE indexname LIKE 'idx_%'
ORDER BY pg_relation_size(indexrelid) DESC;

-- 2. Update table statistics
ANALYZE messages;
ANALYZE conversation_users;
ANALYZE conversations;

-- 3. Verify index usage (run sample queries)
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, content, type, "senderId", "createdAt"
FROM messages
WHERE "conversationId" = (SELECT id FROM conversations LIMIT 1)
ORDER BY "createdAt" DESC
LIMIT 50;
-- Expected: Index Scan using idx_messages_conversation_created_desc, NO Sort node

-- 4. Check index bloat (after 1 week)
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
  pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) as index_size,
  ROUND(100 * (pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename))::numeric / NULLIF(pg_relation_size(schemaname||'.'||tablename), 0), 2) as index_ratio_pct
FROM pg_tables
WHERE schemaname = 'public' AND tablename IN ('messages', 'conversations', 'conversation_users');

-- Rollback Plan (if indexes cause issues)
-- DROP INDEX CONCURRENTLY idx_messages_conversation_created_desc;
-- DROP INDEX CONCURRENTLY idx_conversation_users_user_active;
-- DROP INDEX CONCURRENTLY idx_conversations_updated_desc;

-- Maintenance Schedule
-- - Weekly: REINDEX CONCURRENTLY if bloat ratio > 30%
-- - Monthly: Review pg_stat_user_indexes for unused indexes
-- - Quarterly: Recalculate index sizing based on growth
