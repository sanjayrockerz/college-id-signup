-- Autovacuum Configuration Migration
-- Generated: 2025-10-22
-- Purpose: Tune autovacuum for high-churn tables to prevent bloat and stale statistics

-- IMPORTANT: Apply during low-traffic window (recommended: 2-6 AM)
-- ROLLBACK: Settings can be reset with: ALTER TABLE <name> RESET (autovacuum_*)

-- Global autovacuum settings (already configured at database level)
-- autovacuum = on
-- autovacuum_max_workers = 3
-- autovacuum_naptime = 10s (check interval)

-- Table-specific overrides

-- Message [HOT]
-- High message throughput (1000+ TPS) requires aggressive vacuum to prevent bloat. Frequent analyze keeps JOIN selectivity estimates accurate for conversation queries.
-- Expected write rate: 1000 rows/sec
ALTER TABLE "Message" SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 100,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_analyze_threshold = 100,
  autovacuum_vacuum_cost_limit = 2000,
  autovacuum_vacuum_cost_delay = 2
);

-- MessageReadReceipt [HOT]
-- Extremely high churn from read tracking. Aggressive settings prevent bloat affecting unread count queries. Fresh stats critical for efficient GROUP BY plans.
-- Expected write rate: 2000 rows/sec
ALTER TABLE "MessageReadReceipt" SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 100,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_analyze_threshold = 100,
  autovacuum_vacuum_cost_limit = 2000,
  autovacuum_vacuum_cost_delay = 2
);

-- Conversation [MEDIUM]
-- Moderate update rate from lastMessageAt, unreadCount updates. Balanced settings maintain query performance without excessive I/O.
-- Expected write rate: 200 rows/sec
ALTER TABLE "Conversation" SET (
  autovacuum_vacuum_scale_factor = 0.10,
  autovacuum_vacuum_threshold = 75,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_analyze_threshold = 75,
  autovacuum_vacuum_cost_limit = 1000,
  autovacuum_vacuum_cost_delay = 2
);

-- ConversationParticipant [MEDIUM]
-- Moderate churn from users joining/leaving conversations. Stats accuracy important for participant filtering in conversation lists.
-- Expected write rate: 100 rows/sec
ALTER TABLE "ConversationParticipant" SET (
  autovacuum_vacuum_scale_factor = 0.10,
  autovacuum_vacuum_threshold = 75,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_analyze_threshold = 75,
  autovacuum_vacuum_cost_limit = 1000,
  autovacuum_vacuum_cost_delay = 2
);

-- User [MEDIUM]
-- Low-moderate write rate from profile updates and activity tracking. Balanced settings sufficient for steady-state performance.
-- Expected write rate: 50 rows/sec
ALTER TABLE "User" SET (
  autovacuum_vacuum_scale_factor = 0.10,
  autovacuum_vacuum_threshold = 50,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_analyze_threshold = 50,
  autovacuum_vacuum_cost_limit = 800,
  autovacuum_vacuum_cost_delay = 2
);

-- Session [COLD]
-- Low churn rate. Default PostgreSQL settings appropriate. Vacuum primarily handles expired session cleanup.
-- Expected write rate: 10 rows/sec
ALTER TABLE "Session" SET (
  autovacuum_vacuum_scale_factor = 0.20,
  autovacuum_vacuum_threshold = 50,
  autovacuum_analyze_scale_factor = 0.10,
  autovacuum_analyze_threshold = 50,
  autovacuum_vacuum_cost_limit = 500,
  autovacuum_vacuum_cost_delay = 2
);

-- Verify settings
SELECT schemaname, tablename, reloptions
FROM pg_tables
WHERE schemaname = 'public'
  AND reloptions IS NOT NULL
ORDER BY tablename;

-- Force immediate analyze to refresh statistics
ANALYZE "Message";
ANALYZE "MessageReadReceipt";
ANALYZE "Conversation";
ANALYZE "ConversationParticipant";
ANALYZE "User";
ANALYZE "Session";

-- Monitor vacuum activity
SELECT
  schemaname,
  relname AS tablename,
  n_live_tup AS live_tuples,
  n_dead_tup AS dead_tuples,
  ROUND(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 2) AS dead_pct,
  last_autovacuum,
  last_autoanalyze
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_dead_tup DESC;
