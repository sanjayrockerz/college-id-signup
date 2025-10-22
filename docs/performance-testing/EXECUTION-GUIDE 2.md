# Performance Testing Execution Guide

## 1. Overview
This guide describes how to execute performance tests, monitor runtime behavior, interpret results, and perform cleanup.

## 2. Pre-Run Checklist
- Backend service is running and reachable at `PERF_BASE_URL`.
- Load-test data generated or seeded as required.
- `.env.performance` configured with correct URLs and credentials.
- k6 and Artillery installed and available on `PATH`.

## 3. Running the Suite
Execute the orchestrated runner with desired profile and environment:
```bash
./scripts/performance/run-performance-suite.sh --profile load --env local
```
Optional flags:
- `--skip-cleanup`: retain generated data for inspection.
- `--verbose`: print detailed progress logs.

Artifacts are created under `results/perf/<timestamp>/` including k6 summaries, Artillery reports, metrics CSV, and database analysis.

## 4. Monitoring During Tests
- View system metrics live via `tail -f results/perf/<timestamp>/metrics.csv`.
- Inspect backend logs in real-time (`tail -f logs/app.log`).
- Check database load using `psql` or cloud monitoring dashboards.
- Use `htop` or `top` to confirm CPU/memory baseline.

## 5. Result Interpretation
1. **k6 Summary (`k6-<profile>.json`):**
   - `http_req_duration{p(95)}` should meet profile thresholds.
   - Check for `checks` pass rate ≥ 99%.
2. **Artillery Report (`artillery-<profile>.json`):**
   - Review latency percentiles and Socket.IO handshake errors.
3. **Metrics CSV:**
   - Plot CPU/memory/load trends to confirm resource headroom.
4. **Database Report:**
   - Inspect `query-analysis` JSON for sequential scans or slow queries (>100ms).
5. **Summary File:**
   - Contains pointers to all artifacts and overall status.

## 6. Post-Test Actions
- Archive results directory for future comparison.
- Create incident tickets if thresholds were breached.
- Update documentation with observations or recommended tuning.

## 7. Cleanup Procedures
1. Remove generated test data (if not automatically cleaned):
   ```bash
   DATABASE_URL="<your-connection-string>" npx ts-node scripts/performance/setup/cleanup-test-data.ts --confirm
   ```
2. Stop backend service if not needed:
   ```bash
   npm run stop
   ```
3. Tear down Docker containers (if used):
   ```bash
   docker-compose down
   ```

## 8. Troubleshooting During Execution
| Symptom | Suggested Action |
|---------|------------------|
| Runner exits early with red message | Review console output; check k6 and Artillery logs in results directory. |
| Metrics CSV empty | Ensure metrics collector has execute permissions and started successfully. |
| Artillery run hangs | Verify Socket.IO endpoint availability; check network connectivity. |
| Database analyzer fails | Confirm `PERF_DATABASE_URL` grants read access and Prisma migrations are up-to-date. |
