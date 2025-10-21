#!/bin/bash
# Acceptance Test: MAJOR-004 - Enable 44 skipped integration tests
# Category: testing | Domain: correctness | Severity: major

set -e

echo "=== MAJOR-004: Enable integration tests ==="

# Test 1: Count skipped tests
SKIPPED=$(npm test -- --json 2>/dev/null | jq -r '.numPendingTests // 44')
if [ "$SKIPPED" -gt 5 ]; then
    echo "❌ FAIL: Still have $SKIPPED skipped tests (target: ≤5)"
    exit 1
fi
echo "✅ PASS: Skipped tests reduced to $SKIPPED"

# Test 2: Verify passing tests increased
PASSING=$(npm test -- --json 2>/dev/null | jq -r '.numPassedTests // 0')
if [ "$PASSING" -lt 40 ]; then
    echo "❌ FAIL: Only $PASSING tests passing (target: ≥40)"
    exit 1
fi
echo "✅ PASS: $PASSING tests now passing"

# Test 3: Verify zero failing tests
FAILING=$(npm test -- --json 2>/dev/null | jq -r '.numFailedTests // 0')
if [ "$FAILING" -gt 0 ]; then
    echo "❌ FAIL: $FAILING tests failing"
    exit 1
fi
echo "✅ PASS: Zero failing tests"

# Test 4: Verify Socket.IO integration tests enabled
if ! npm test -- socket-api.integration.spec 2>&1 | grep -q "passing"; then
    echo "❌ FAIL: Socket.IO integration tests not enabled"
    exit 1
fi
echo "✅ PASS: Socket.IO integration tests enabled"

# Test 5: Verify REST API integration tests enabled
if ! npm test -- chat-api.integration.spec 2>&1 | grep -q "passing"; then
    echo "❌ FAIL: REST API integration tests not enabled"
    exit 1
fi
echo "✅ PASS: REST API integration tests enabled"

echo ""
echo "=== ALL TESTS PASSED ==="
exit 0
