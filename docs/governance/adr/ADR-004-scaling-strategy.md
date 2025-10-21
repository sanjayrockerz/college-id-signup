# ADR-004: Scaling Strategy

## Status
Accepted

## Decision
Horizontal scaling with 3+ instances and Redis pub/sub for Socket.IO adapter.

## Consequences
- Requires sticky sessions and Redis infra
- Enables scale-out with minimal code changes
