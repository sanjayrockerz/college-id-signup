#!/bin/bash

# Progressive Load Test Execution - Stage 2: Light Load
# 20 VUs for 2 minutes - Stress connection pool and rate limiter bypass

CONVERSATION_ID="8822dd87-d0c2-42be-93d2-1c0cb492e351"
USER_ID="00000000-0000-0000-0000-000000000000"
export CONVERSATION_IDS="$CONVERSATION_ID"
export USER_IDS="$USER_ID"
export CHAT_BASE_URL="http://localhost:3001/api/v1/chat"

STAGE_NAME="light"
VUS=20
DURATION=120

echo "=========================================="
echo "STAGE 2: LIGHT LOAD TEST"
echo "=========================================="
echo "VUs: $VUS (4x Stage 1)"
echo "Duration: ${DURATION}s (4x Stage 1)"
echo "Expected Throughput: ~40 req/s"
echo "Expected Connections: 2-3 concurrent"
echo "Started: $(date)"
echo "=========================================="
echo

# Create results directory
mkdir -p ./docs/validation/progressive-tests

# Run k6 test
k6 run \
  --vus "$VUS" \
  --duration "${DURATION}s" \
  --summary-export="./docs/validation/progressive-tests/stage2-light-${VUS}vu.json" \
  scripts/performance/chat-load-test.k6.js

exit_code=$?

echo
echo "=========================================="
echo "STAGE 2 COMPLETE"
echo "=========================================="
echo "Exit Code: $exit_code"
echo "Completed: $(date)"
echo "=========================================="

exit $exit_code
