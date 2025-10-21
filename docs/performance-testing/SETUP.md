# Performance Testing Setup Guide

## 1. Prerequisites
- **Operating System:** macOS, Linux, or Windows Subsystem for Linux (WSL2)
- **Node.js:** v18.x or newer (`node -v`)
- **npm:** v9.x or newer (`npm -v`)
- **PostgreSQL:** v15.x or newer (`psql --version`)
- **Docker:** Optional, for running dependent services locally
- **Hardware:** Minimum 4 CPU cores, 8 GB RAM to avoid resource contention during load tests

## 2. Tool Installation
1. Install project dependencies:
   ```bash
   npm install
   ```
2. Install k6 (macOS example):
   ```bash
   brew install k6
   ```
   Verify:
   ```bash
   k6 version
   ```
3. Install Artillery globally:
   ```bash
   npm install -g artillery
   ```
   Verify:
   ```bash
   artillery --version
   ```
4. Ensure Prisma CLI is available:
   ```bash
   npx prisma --version
   ```

## 3. Environment Configuration
1. Copy the template:
   ```bash
   cp .env.example .env
   cp .env.performance.example .env.performance
   ```
2. Update `.env` with service configuration (ports, storage, etc.).
3. Update `.env.performance` with:
   - `PERF_BASE_URL`: HTTP endpoint for load tests
   - `PERF_DATABASE_URL`: Connection string for analyzers and seed scripts
   - `PERF_PROFILE`: Default test profile (smoke, load, stress, soak)
   - `PERF_ENV`: Target environment (local, staging)
4. Validate environment variables:
   ```bash
   node -e "require('dotenv').config({ path: '.env.performance' }); console.log(process.env.PERF_BASE_URL);"
   ```

## 4. Database Setup
1. Start PostgreSQL (skip if using managed database):
   ```bash
   docker-compose up -d postgres
   ```
2. Apply schema:
   ```bash
   DATABASE_URL="<your-connection-string>" npx prisma db push
   ```
3. Verify connectivity:
   ```bash
   PGPASSWORD=<password> psql <your-connection-string> -c "SELECT 1"
   ```

## 5. Service Startup
1. Build and launch backend:
   ```bash
   npm run build
   npm run start
   ```
2. Confirm health endpoints:
   ```bash
   curl http://localhost:3001/health
   curl http://localhost:3001/health/database
   ```

## 6. Test Data Generation
Populate load-test entities:
```bash
DATABASE_URL="<your-connection-string>" npx ts-node scripts/performance/setup/generate-test-data.ts
```
Expected output includes counts of conversations/messages inserted.

## 7. Smoke Test Verification
Run a quick end-to-end validation:
```bash
./scripts/performance/run-performance-suite.sh --profile smoke --env local --verbose
```
Confirm reports are created under `results/perf/<timestamp>/`.

## 8. Troubleshooting
| Issue | Resolution |
|-------|------------|
| `k6: command not found` | Install k6 via Homebrew or official binaries. |
| `psql: could not connect` | Check PostgreSQL service, credentials, or firewall rules. |
| Prisma `ECONNREFUSED` | Ensure DATABASE_URL points to a reachable database; verify SSL requirements. |
| `Artillery validation failed` | Confirm YAML syntax in Artillery config and ensure Socket.IO endpoint is live. |
| `collect-metrics.js` permission denied | Add executable flag: `chmod +x scripts/performance/monitoring/collect-metrics.js`. |
| Load tests fail immediately | Verify backend is running and accessible at `PERF_BASE_URL`. |
