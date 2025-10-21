# ADR-002: No-Auth Posture

## Status
Accepted

## Context
Service is identity-agnostic; upstream systems handle authentication.

## Decision
Do not implement authentication in this service.

## Consequences
- Simpler service, faster performance
- Requires strict network and rate limiting controls
