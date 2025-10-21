#!/bin/bash
# Acceptance Test: MAJOR-002 - Fix 2 high severity npm vulnerabilities
# Category: security | Domain: security | Severity: major

set -e

echo "=== MAJOR-002: Fix high severity npm vulnerabilities ==="

# Test 1: Run npm audit
AUDIT_OUTPUT=$(npm audit --json 2>/dev/null || echo '{"metadata":{"vulnerabilities":{"high":999}}}')
HIGH_VULNS=$(echo "$AUDIT_OUTPUT" | jq -r '.metadata.vulnerabilities.high // 999')

if [ "$HIGH_VULNS" -gt 0 ]; then
    echo "❌ FAIL: Found $HIGH_VULNS high severity vulnerabilities"
    npm audit | grep -A 5 "high"
    exit 1
fi
echo "✅ PASS: Zero high severity vulnerabilities"

# Test 2: Verify moderate vulnerabilities addressed
MODERATE_VULNS=$(echo "$AUDIT_OUTPUT" | jq -r '.metadata.vulnerabilities.moderate // 999')
if [ "$MODERATE_VULNS" -gt 0 ]; then
    echo "⚠️  WARNING: Found $MODERATE_VULNS moderate vulnerabilities (acceptable if documented)"
fi

# Test 3: Verify no critical vulnerabilities introduced
CRITICAL_VULNS=$(echo "$AUDIT_OUTPUT" | jq -r '.metadata.vulnerabilities.critical // 0')
if [ "$CRITICAL_VULNS" -gt 0 ]; then
    echo "❌ FAIL: Found $CRITICAL_VULNS critical vulnerabilities"
    exit 1
fi
echo "✅ PASS: Zero critical vulnerabilities"

# Test 4: Verify dependencies install cleanly
if ! npm install --package-lock-only > /dev/null 2>&1; then
    echo "❌ FAIL: npm install failed"
    exit 1
fi
echo "✅ PASS: Dependencies install successfully"

# Test 5: Verify build still passes
if ! npm run build > /dev/null 2>&1; then
    echo "❌ FAIL: Build failed after dependency updates"
    exit 1
fi
echo "✅ PASS: Build successful after security fixes"

echo ""
echo "=== ALL TESTS PASSED ==="
exit 0
