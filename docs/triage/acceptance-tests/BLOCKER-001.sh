#!/bin/bash
# Acceptance Test: BLOCKER-001 - Remove src/idcard/ module
# Category: college | Domain: stability | Severity: blocker

set -e

echo "=== BLOCKER-001: Remove src/idcard/ module ==="

# Test 1: Verify directory deletion
if [ -d "src/idcard" ]; then
    echo "❌ FAIL: src/idcard/ directory still exists"
    exit 1
fi
echo "✅ PASS: src/idcard/ directory removed"

# Test 2: Verify no imports from idcard module
if grep -r "from.*['\"].*idcard" src/ --include="*.ts" --include="*.js" 2>/dev/null; then
    echo "❌ FAIL: Found imports from idcard module"
    exit 1
fi
echo "✅ PASS: No imports from idcard module"

# Test 3: Verify IdcardModule not in app.module.ts
if grep -q "IdcardModule" src/app.module.ts 2>/dev/null; then
    echo "❌ FAIL: IdcardModule still referenced in app.module.ts"
    exit 1
fi
echo "✅ PASS: IdcardModule removed from app.module.ts"

# Test 4: Verify TypeScript compilation passes
if ! npm run build > /dev/null 2>&1; then
    echo "❌ FAIL: TypeScript compilation failed"
    exit 1
fi
echo "✅ PASS: TypeScript compilation successful"

# Test 5: Verify server boots
timeout 10s npm run start:dev > /tmp/boot-test.log 2>&1 &
SERVER_PID=$!
sleep 5

if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "❌ FAIL: Server failed to boot"
    cat /tmp/boot-test.log
    exit 1
fi

kill $SERVER_PID 2>/dev/null || true
echo "✅ PASS: Server boots successfully"

# Test 6: Verify no idcard routes exist
if curl -s http://localhost:3001/api/idcard/status 2>/dev/null | grep -v "Cannot GET"; then
    echo "❌ FAIL: ID card routes still accessible"
    exit 1
fi
echo "✅ PASS: ID card routes removed"

echo ""
echo "=== ALL TESTS PASSED ==="
exit 0
