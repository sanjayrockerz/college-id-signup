-- Autovacuum Configuration Rollback
-- Generated: 2025-10-22
-- Purpose: Reset autovacuum settings to PostgreSQL defaults

-- IMPORTANT: This will revert all tables to default autovacuum behavior
-- Use this if custom settings cause issues or need to be reverted

-- Reset Message
ALTER TABLE "Message" RESET (
  autovacuum_vacuum_scale_factor,
  autovacuum_vacuum_threshold,
  autovacuum_analyze_scale_factor,
  autovacuum_analyze_threshold,
  autovacuum_vacuum_cost_limit,
  autovacuum_vacuum_cost_delay
);

-- Reset MessageReadReceipt
ALTER TABLE "MessageReadReceipt" RESET (
  autovacuum_vacuum_scale_factor,
  autovacuum_vacuum_threshold,
  autovacuum_analyze_scale_factor,
  autovacuum_analyze_threshold,
  autovacuum_vacuum_cost_limit,
  autovacuum_vacuum_cost_delay
);

-- Reset Conversation
ALTER TABLE "Conversation" RESET (
  autovacuum_vacuum_scale_factor,
  autovacuum_vacuum_threshold,
  autovacuum_analyze_scale_factor,
  autovacuum_analyze_threshold,
  autovacuum_vacuum_cost_limit,
  autovacuum_vacuum_cost_delay
);

-- Reset ConversationParticipant
ALTER TABLE "ConversationParticipant" RESET (
  autovacuum_vacuum_scale_factor,
  autovacuum_vacuum_threshold,
  autovacuum_analyze_scale_factor,
  autovacuum_analyze_threshold,
  autovacuum_vacuum_cost_limit,
  autovacuum_vacuum_cost_delay
);

-- Reset User
ALTER TABLE "User" RESET (
  autovacuum_vacuum_scale_factor,
  autovacuum_vacuum_threshold,
  autovacuum_analyze_scale_factor,
  autovacuum_analyze_threshold,
  autovacuum_vacuum_cost_limit,
  autovacuum_vacuum_cost_delay
);

-- Reset Session
ALTER TABLE "Session" RESET (
  autovacuum_vacuum_scale_factor,
  autovacuum_vacuum_threshold,
  autovacuum_analyze_scale_factor,
  autovacuum_analyze_threshold,
  autovacuum_vacuum_cost_limit,
  autovacuum_vacuum_cost_delay
);

-- Verify reset
SELECT schemaname, tablename, reloptions
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- Force analyze after reset
ANALYZE "Message";
ANALYZE "MessageReadReceipt";
ANALYZE "Conversation";
ANALYZE "ConversationParticipant";
ANALYZE "User";
ANALYZE "Session";
