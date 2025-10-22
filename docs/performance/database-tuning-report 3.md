# Database Tuning Report

## Indexing

- Verify composite index on messages: (conversationId, createdAt DESC)
- Expected wins: Query uses index for ORDER BY createdAt, reduces sort cost.

## Pooling

- Prisma pool sizing: min=5, max=20

## Timeouts

- PostgreSQL statement_timeout=5s

## Slow Query Analysis

- Enable Prisma query logging
- Flag queries >500ms; review with EXPLAIN ANALYZE

## Results (placeholder)

- Before: p95 history=420ms
- After: p95 history=220ms
