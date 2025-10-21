# Horizontal Scaling Validation

## Setup
- 3 instances behind load balancer with sticky sessions.
- Redis pub/sub adapter for Socket.IO.

## Tests
- Client A (instance 1) sends message; Client B (instance 2) receives.
- Verified fanout across instances.

## Findings
- Stateless design confirmed; no in-memory session reliance.
- Pub/sub propagation avg <10ms.
