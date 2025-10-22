# Bottleneck Analysis

Document any performance constraints identified during the load assessment. If no bottlenecks were found, note the validation steps performed to reach that conclusion.

## Summary

- Status: <!-- PASS / FAIL -->
- Overall Impact: <!-- e.g., Minor latency spikes during spike phase -->
- Owner: <!-- Engineering lead responsible for remediation -->

## Top Findings

1. **Description:** <!-- e.g., Message history p95 exceeded target during spike sustain -->
   - Evidence: <!-- metric screenshots/log excerpts -->
   - Root Cause Hypothesis: <!-- database contention, CPU saturation, etc. -->
   - Recommended Fix: <!-- query optimization, scaling, caching -->
   - Priority: <!-- P0/P1/P2 -->

2. **Description:**
   - Evidence:
   - Root Cause Hypothesis:
   - Recommended Fix:
   - Priority:

3. **Description:**
   - Evidence:
   - Root Cause Hypothesis:
   - Recommended Fix:
   - Priority:

## Supporting Data

- Link to load test run artefacts: <!-- URL or path -->
- Link to database audit section: <!-- Section reference -->
- Observability dashboards consulted: <!-- e.g., Grafana board URL -->

## Next Steps

- [ ] Confirm remediation owners and timelines
- [ ] Schedule re-test after fixes
- [ ] Update SLO dashboards / alerts
