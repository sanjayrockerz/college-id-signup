# Caching Strategy Evaluation

## Targets

- Conversation metadata: TTL 5m
- Recent messages (last 20): TTL 1m

## Invalidation

- On message send: invalidate conversation metadata and recent messages cache.

## Estimates

- Hit rate: >70%
- Latency reduction: >30%

## Decision

- Implement Redis caching after load test if p95 history >300ms.
