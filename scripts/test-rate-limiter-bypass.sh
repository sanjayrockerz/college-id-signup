#!/bin/bash

# Rate Limiter Bypass Verification Script
# Tests if DISABLE_RATE_LIMIT=true successfully disables all rate limiters

CONVERSATION_ID="8822dd87-d0c2-42be-93d2-1c0cb492e351"
USER_ID="00000000-0000-0000-0000-000000000000"
BASE_URL="http://localhost:3001/api/v1/chat"
REQUEST_COUNT=250

echo "================================================="
echo "Rate Limiter Bypass Test"
echo "================================================="
echo "Target: $BASE_URL"
echo "Requests: $REQUEST_COUNT"
echo "Expected: 0 rate limit errors (429 status)"
echo "================================================="
echo

# Counter for 429 responses
rate_limit_errors=0
success_count=0
error_count=0

echo "Sending $REQUEST_COUNT requests..."

for i in $(seq 1 $REQUEST_COUNT); do
  response=$(curl -s -w "\n%{http_code}" -X POST \
    "$BASE_URL/conversations/$CONVERSATION_ID/messages" \
    -H "Content-Type: application/json" \
    -d "{
      \"userId\": \"$USER_ID\",
      \"content\": \"Load test message $i - $(date +%s)\"
    }" 2>&1)
  
  status_code=$(echo "$response" | tail -n 1)
  
  if [ "$status_code" == "429" ]; then
    rate_limit_errors=$((rate_limit_errors + 1))
    echo "❌ Request $i: Rate limit error (429)"
  elif [ "$status_code" == "201" ] || [ "$status_code" == "200" ]; then
    success_count=$((success_count + 1))
    if [ $((i % 50)) -eq 0 ]; then
      echo "✅ Progress: $i/$REQUEST_COUNT requests (${success_count} successful)"
    fi
  else
    error_count=$((error_count + 1))
    if [ $((i % 50)) -eq 0 ]; then
      echo "⚠️  Request $i: HTTP $status_code"
    fi
  fi
done

echo
echo "================================================="
echo "Test Results"
echo "================================================="
echo "Total Requests:      $REQUEST_COUNT"
echo "Successful (2xx):    $success_count"
echo "Rate Limit (429):    $rate_limit_errors"
echo "Other Errors:        $error_count"
echo "================================================="
echo

if [ $rate_limit_errors -eq 0 ]; then
  echo "✅ PASS: Rate limiting bypass is working correctly!"
  echo "   All rate limiters successfully disabled."
  exit 0
else
  echo "❌ FAIL: Rate limiting is still active!"
  echo "   $rate_limit_errors requests were blocked with 429 status."
  echo "   Check DISABLE_RATE_LIMIT environment variable."
  exit 1
fi
