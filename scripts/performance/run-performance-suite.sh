#!/bin/bash
set -euo pipefail

PROFILE="smoke"
TARGET_ENV="local"
SKIP_CLEANUP=false
VERBOSE=false

usage() {
  cat <<'USAGE'
Usage: run-performance-suite.sh [options]

Options:
  --profile <smoke|load|stress|soak>  Load profile to execute (default: smoke)
  --env <local|staging>               Target environment selection (default: local)
  --skip-cleanup                      Skip cleanup of generated data
  --verbose                           Enable verbose logging
  -h, --help                          Show this help message
USAGE
}

log() {
  if [ "$VERBOSE" = true ]; then
    echo "[$(date -Iseconds)] $*"
  fi
}

error_exit() {
  local msg="$1"
  echo -e "\033[31mERROR:\033[0m $msg" >&2
  exit 1
}

trap 'error_exit "Command failed on line $LINENO."' ERR

ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --profile)
      PROFILE="$2"; shift 2 ;;
    --env)
      TARGET_ENV="$2"; shift 2 ;;
    --skip-cleanup)
      SKIP_CLEANUP=true; shift ;;
    --verbose)
      VERBOSE=true; shift ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      ARGS+=("$1"); shift ;;
  esac
done

if [ "${#ARGS[@]}" -gt 0 ]; then
  error_exit "Unknown arguments: ${ARGS[*]}"
fi

if ! [[ "$PROFILE" =~ ^(smoke|load|stress|soak)$ ]]; then
  error_exit "Invalid profile: $PROFILE"
fi

if ! [[ "$TARGET_ENV" =~ ^(local|staging)$ ]]; then
  error_exit "Invalid environment: $TARGET_ENV"
fi

function command_exists() {
  command -v "$1" >/dev/null 2>&1
}

command_exists k6 || error_exit "k6 is required. Install from https://k6.io/docs/getting-started/installation/"
command_exists artillery || error_exit "Artillery is required. Install via 'npm install -g artillery'."
command_exists psql || log "psql not found; database checks may fail."

if [ -f .env.performance ]; then
  set -o allexport
  # shellcheck disable=SC1091
  source .env.performance
  set +o allexport
fi

RESULTS_DIR="${PERF_RESULTS_DIR:-results/perf}"/$(date +%Y%m%dT%H%M%S)
mkdir -p "$RESULTS_DIR"

CONFIG_FILE="config/performance/load-test-profiles.json"
if [ ! -f "$CONFIG_FILE" ]; then
  error_exit "Missing configuration file: $CONFIG_FILE"
fi

BASE_URL="${PERF_BASE_URL:-http://localhost:3001}"
DATABASE_URL="${PERF_DATABASE_URL:-postgresql://postgres:password@localhost:5432/chat_backend_db?schema=public}"
K6_SCRIPT="${K6_REST_SCRIPT:-scripts/performance/load-tests/rest-api-load.js}"
ARTILLERY_CONFIG="${ARTILLERY_SOCKET_CONFIG:-scripts/performance/load-tests/socket-load.yaml}"
METRICS_INTERVAL="${METRICS_INTERVAL:-5}"
PROFILE_JSON=$(node -e "const cfg=require('./$CONFIG_FILE');console.log(JSON.stringify(cfg.profiles['$PROFILE']||{}));")
if [ -z "$PROFILE_JSON" ]; then
  error_exit "Profile $PROFILE not found in $CONFIG_FILE"
fi

VU_COUNT=$(node -e "const p=$PROFILE_JSON;console.log(p.vuCount||'')")
TEST_DURATION=$(node -e "const p=$PROFILE_JSON;console.log(p.duration||'')")
if [ -z "$VU_COUNT" ] || [ -z "$TEST_DURATION" ]; then
  error_exit "Profile $PROFILE missing vuCount/duration."
fi

curl --silent --fail "$BASE_URL/health" >/dev/null || log "Health endpoint not reachable; continuing."

log "Checking database connectivity"
if command_exists psql; then
  PGCONNECT_TIMEOUT=5 PGPASSWORD=$(node -e "try{console.log(new URL('$DATABASE_URL').password)}catch(e){console.log('')}" ) \
  psql "$DATABASE_URL" -c "SELECT 1" >/dev/null || log "Database check failed; continuing."
fi

log "Verifying test data availability"
if command_exists npx; then
  npx ts-node --transpile-only scripts/performance/db-analysis/query-analyzer.ts >/dev/null 2>&1 || log "Baseline query analysis skipped."
fi

METRICS_FILE="$RESULTS_DIR/metrics.csv"
METRICS_PID=""
function start_metrics() {
  log "Starting metrics collector"
  METRICS_INTERVAL="$METRICS_INTERVAL" OUTPUT_FILE="$METRICS_FILE" \
    node scripts/performance/monitoring/collect-metrics.js >/dev/null &
  METRICS_PID=$!
}

function stop_metrics() {
  if [ -n "$METRICS_PID" ] && kill -0 "$METRICS_PID" 2>/dev/null; then
    log "Stopping metrics collector"
    kill "$METRICS_PID" || true
    wait "$METRICS_PID" || true
  fi
}

trap 'stop_metrics' EXIT

start_metrics
sleep 1

log "Running k6 REST load test"
K6_OUT="$RESULTS_DIR/k6-${PROFILE}.json"
K6_ENV="BASE_URL=$BASE_URL VU_COUNT=$VU_COUNT TEST_DURATION=$TEST_DURATION"
( eval "${K6_ENV} k6 run ${K6_FLAGS:-} $K6_SCRIPT --summary-export=$K6_OUT" ) || error_exit "k6 test failed"

log "Running Artillery socket test"
ARTILLERY_OUT="$RESULTS_DIR/artillery-${PROFILE}.json"
( artillery run ${ARTILLERY_FLAGS:-} "$ARTILLERY_CONFIG" --output "$ARTILLERY_OUT" ) || error_exit "Artillery test failed"

log "Running database query analyzer"
DB_REPORT_DIR="$RESULTS_DIR/db"
mkdir -p "$DB_REPORT_DIR"
DATABASE_URL="$DATABASE_URL" OUTPUT_FILE="$DB_REPORT_DIR/query-analysis.json" \
  node -e "const fs=require('fs');const path=require('path');const { spawnSync }=require('child_process');const report=path.join('$DB_REPORT_DIR', 'query-analysis.json');const env=Object.assign({},process.env,{DATABASE_URL:'$DATABASE_URL'});const {status}=spawnSync('npx',['ts-node','--transpile-only','scripts/performance/db-analysis/query-analyzer.ts'],{stdio:'inherit',env});if(status!==0)process.exit(status);fs.renameSync(fs.readdirSync('docs/validation/performance').filter(f=>f.startsWith('query-analysis-')).sort().slice(-1)[0],'$DB_REPORT_DIR/query-analysis.json');" || error_exit "Database analyzer failed"

stop_metrics

SUMMARY_FILE="$RESULTS_DIR/summary.txt"
{
  echo "Performance Test Summary"
  echo "Profile: $PROFILE"
  echo "Environment: $TARGET_ENV"
  echo "Base URL: $BASE_URL"
  echo "Results directory: $RESULTS_DIR"
  echo "k6 report: $K6_OUT"
  echo "Artillery report: $ARTILLERY_OUT"
  echo "Metrics CSV: $METRICS_FILE"
} > "$SUMMARY_FILE"

if [ "$SKIP_CLEANUP" = false ] && [ "${PERF_AUTO_CLEANUP:-true}" = "true" ]; then
  log "Running cleanup script"
  DATABASE_URL="$DATABASE_URL" npx ts-node --transpile-only scripts/performance/setup/cleanup-test-data.ts --confirm || log "Cleanup script reported an error"
fi

echo -e "\033[32mPerformance test suite completed. Summary: $SUMMARY_FILE\033[0m"
