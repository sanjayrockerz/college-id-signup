#!/bin/bash

# Progressive Load Test Execution - Stage 1: Smoke Test
# 5 VUs for 30 seconds - Baseline validation

CONVERSATION_ID="8822dd87-d0c2-42be-93d2-1c0cb492e351"
USER_ID="00000000-0000-0000-0000-000000000000"
export CONVERSATION_IDS="$CONVERSATION_ID"
export USER_IDS="$USER_ID"
export CHAT_BASE_URL="http://localhost:3001/api/v1/chat"

STAGE_NAME="smoke"
VUS=5
DURATION=30

echo "=========================================="
echo "STAGE 1: SMOKE TEST"
echo "=========================================="
echo "VUs: $VUS"
echo "Duration: ${DURATION}s"
echo "Base URL: $CHAT_BASE_URL"
echo "Started: $(date)"
echo "=========================================="
echo

# Create results directory
mkdir -p ./docs/validation/progressive-tests

# Run k6 test
k6 run \
  --vus "$VUS" \
  --duration "${DURATION}s" \
  --summary-export="./docs/validation/progressive-tests/stage1-smoke-${VUS}vu.json" \
  scripts/performance/chat-load-test.k6.js

exit_code=$?

echo
echo "=========================================="
echo "STAGE 1 COMPLETE"
echo "=========================================="
echo "Exit Code: $exit_code"
echo "Completed: $(date)"
echo "=========================================="

exit $exit_code
