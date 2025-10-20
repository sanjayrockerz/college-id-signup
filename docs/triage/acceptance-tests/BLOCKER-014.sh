#!/bin/bash
# Acceptance Test: BLOCKER-014 - Delete frontend/ directory
# Category: frontend | Domain: stability | Severity: blocker

set -e

echo "=== BLOCKER-014: Delete frontend/ directory ==="

# Test 1: Verify directory deletion
if [ -d "frontend" ]; then
    echo "❌ FAIL: frontend/ directory still exists"
    exit 1
fi
echo "✅ PASS: frontend/ directory removed"

# Test 2: Verify no frontend build scripts in package.json
if grep -q "\"client\"" package.json 2>/dev/null; then
    echo "❌ FAIL: Found frontend/client scripts in package.json"
    exit 1
fi
echo "✅ PASS: No frontend scripts in package.json"

# Test 3: Verify no frontend dependencies
if grep -E "(react|vite|@vitejs)" package.json 2>/dev/null; then
    echo "❌ FAIL: Found frontend dependencies in package.json"
    exit 1
fi
echo "✅ PASS: No frontend dependencies"

# Test 4: Verify TypeScript compilation (backend only)
if ! npm run build > /dev/null 2>&1; then
    echo "❌ FAIL: Backend build failed"
    exit 1
fi
echo "✅ PASS: Backend builds successfully"

# Test 5: Verify no static file serving routes
if grep -r "express.static\|serveStatic" src/ --include="*.ts" 2>/dev/null; then
    echo "⚠️  WARNING: Found static file serving - verify if needed"
fi
echo "✅ PASS: Static serving check complete"

echo ""
echo "=== ALL TESTS PASSED ==="
exit 0
