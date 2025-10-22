# RUNBOOK-002: Connection Storm (>1000 concurrent)

## Symptoms
- connection_count_gauge spike, WebSocket CPU high

## Diagnosis
- Check IP patterns for bot traffic
- DDoS vs legitimate spike

## Remediation
- Enable backpressure (reject new connections gracefully)
- Scale instances
- Coordinate upstream rate limiting

## Escalation
- Escalate to Security if DDoS confirmed
