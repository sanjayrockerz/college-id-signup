# Database Performance Audit

> Populate this document after executing query-plan inspections against the live database. The sections below outline the required evidence and recommended collection commands.

## Summary Table

| Query Path | Execution Time (ms) | Rows Scanned | Index Used | Status |
|------------|---------------------|--------------|------------|--------|
| Message insert |  |  |  |  |
| Message history fetch |  |  |  |  |
| Conversation list |  |  |  |  |

Status legend: ✅ optimal plan (index scan), ⚠️ acceptable (needs follow-up), ❌ regression (seq scan or >100 ms).

## 1. Query Plan Analysis

### 1.1 Message History Fetch

```
EXPLAIN ANALYZE
SELECT id, conversation_id, sender_id, content, created_at
FROM messages
WHERE conversation_id = $1
ORDER BY created_at DESC
LIMIT 20 OFFSET $2;
```

- Expected index: `idx_messages_conversation_created_at (conversation_id, created_at DESC)`
- Evidence:
  - Execution time: <!-- e.g., 12.3 ms -->
  - Rows removed by filter: <!-- should be 0 -->
  - Buffers hit vs read: <!-- e.g., shared hit 40 / read 0 -->
  - Observations: <!-- note if bitmap index scan, etc. -->

### 1.2 Message Insert

```
EXPLAIN (ANALYZE, BUFFERS)
INSERT INTO messages (id, conversation_id, sender_id, content, created_at)
VALUES ($1, $2, $3, $4, NOW())
RETURNING id;
```

- Expected index updates: primary key, `idx_messages_conversation_created_at`
- Evidence:
  - Execution time:
  - Buffers dirtied vs written:
  - Lock waits:
  - Observations:

### 1.3 Conversation List

```
EXPLAIN ANALYZE
SELECT id, updated_at, title
FROM conversations
WHERE is_archived = false
ORDER BY updated_at DESC
LIMIT 10;
```

- Expected index: `idx_conversations_updated_at`
- Evidence:
  - Execution time:
  - Rows scanned:
  - Plan type:
  - Observations:

## 2. Index Validation

Use the following queries (PostgreSQL examples) and paste the results.

```sql
SELECT
  relname AS table,
  ROUND(idx_scan * 100.0 / NULLIF(idx_scan + seq_scan, 0), 2) AS index_hit_ratio
FROM pg_stat_user_tables
ORDER BY index_hit_ratio ASC;
```

- Global index hit ratio: <!-- target > 95% -->
- Table-level findings:
  - `messages`: <!-- e.g., 99.2% (✅) -->
  - `conversations`: <!-- ... -->
  - `conversation_users`: <!-- ... -->

Check for missing indexes:

```sql
SELECT schemaname, relname, seq_scan, idx_scan
FROM pg_stat_user_tables
WHERE seq_scan > 0 AND idx_scan = 0;
```

- Observations: <!-- ensure no large tables show up -->

## 3. Slow Query Detection

- Statement timeout configured: <!-- e.g., 5s -->
- pg_stat_statements sample (top 5 slow queries > 500 ms):

```
SELECT query, calls, mean_exec_time, max_exec_time
FROM pg_stat_statements
WHERE mean_exec_time > 500
ORDER BY mean_exec_time DESC
LIMIT 5;
```

- Findings:
  1. <!-- Query signature, root cause, remediation -->
  2. <!-- ... -->

- N+1 Detection:
  - Evidence from application logs / APM traces:
  - Impact:

## 4. Connection Pool Health

- Pool configuration (min/max, idle timeout):
- Observed utilization (active/idle/waiting) during load test:
- Pool exhaustion events:
- Connection leaks detected:

## 5. Recommendations

1. <!-- Prioritized action item with owner -->
2. <!-- Additional tuning or monitoring suggestion -->
3. <!-- Optional -->
