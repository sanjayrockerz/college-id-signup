#!/bin/bash

# Progressive K6 Load Test Suite
# Tests backend stability under increasing load from 5 to 120 VUs

CONVERSATION_ID="8822dd87-d0c2-42be-93d2-1c0cb492e351"
USER_ID="00000000-0000-0000-0000-000000000000"
export CONVERSATION_IDS="$CONVERSATION_ID"
export USER_IDS="$USER_ID"
export CHAT_BASE_URL="http://localhost:3001/api/v1/chat"

RESULTS_DIR="./docs/validation/progressive-load-tests"
mkdir -p "$RESULTS_DIR"

echo "========================================================"
echo "Progressive Load Test Suite"
echo "========================================================"
echo "Test Conversation: $CONVERSATION_ID"
echo "Test User: $USER_ID"
echo "Base URL: $CHAT_BASE_URL"
echo "Results Directory: $RESULTS_DIR"
echo "========================================================"
echo

# Test phases with increasing load
declare -a PHASES=(
  "5:30:baseline"
  "10:60:light"
  "25:120:medium"
  "50:180:high"
  "75:240:peak"
  "100:300:stress"
  "120:300:ultimate"
)

test_passed=0
test_failed=0
breaking_point=""

for phase in "${PHASES[@]}"; do
  IFS=':' read -r vus duration phase_name <<< "$phase"
  
  echo "========================================================"
  echo "Phase: $phase_name (${vus} VUs for ${duration}s)"
  echo "========================================================"
  
  result_file="$RESULTS_DIR/${phase_name}-${vus}vu-${duration}s.json"
  
  # Run k6 test
  k6 run \
    --vus "$vus" \
    --duration "${duration}s" \
    --summary-export="$result_file" \
    scripts/performance/chat-load-test.k6.js
  
  exit_code=$?
  
  if [ $exit_code -eq 0 ]; then
    echo "✅ Phase $phase_name PASSED"
    test_passed=$((test_passed + 1))
    
    # Extract key metrics
    if [ -f "$result_file" ]; then
      error_rate=$(cat "$result_file" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data['metrics'].get('http_req_failed', {}).get('rate', 0))" 2>/dev/null || echo "N/A")
      p95_latency=$(cat "$result_file" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data['metrics'].get('http_req_duration', {}).get('p(95)', 0))" 2>/dev/null || echo "N/A")
      
      echo "  Error Rate: ${error_rate}"
      echo "  P95 Latency: ${p95_latency}ms"
    fi
  else
    echo "❌ Phase $phase_name FAILED (exit code: $exit_code)"
    test_failed=$((test_failed + 1))
    
    if [ -z "$breaking_point" ]; then
      breaking_point="$phase_name (${vus} VUs)"
      echo "  ⚠️  BREAKING POINT IDENTIFIED: $breaking_point"
    fi
    
    # Don't continue if test failed
    echo "  Stopping progressive tests due to failure."
    break
  fi
  
  echo
  
  # Give backend time to recover between tests
  if [ "$phase_name" != "ultimate" ]; then
    echo "Cooling down for 30 seconds..."
    sleep 30
    echo
  fi
done

echo "========================================================"
echo "Test Suite Summary"
echo "========================================================"
echo "Passed: $test_passed phases"
echo "Failed: $test_failed phases"

if [ -n "$breaking_point" ]; then
  echo "Breaking Point: $breaking_point"
else
  echo "Breaking Point: None detected (all tests passed!)"
fi

echo "========================================================"
echo

if [ $test_failed -eq 0 ]; then
  echo "✅ SUCCESS: All progressive load tests passed!"
  echo "   Backend is stable up to 120 concurrent VUs."
  exit 0
else
  echo "⚠️  WARNING: Load tests failed at $breaking_point"
  echo "   Review logs and metrics in $RESULTS_DIR"
  exit 1
fi
