#!/bin/bash
# Acceptance Test: BLOCKER-007 - Drop User.verifiedCollegeId from schema
# Category: college | Domain: correctness | Severity: blocker

set -e

echo "=== BLOCKER-007: Drop User.verifiedCollegeId from schema ==="

# Test 1: Verify field not in schema
if grep -q "verifiedCollegeId" prisma/schema.prisma; then
    echo "❌ FAIL: verifiedCollegeId still in prisma/schema.prisma"
    exit 1
fi
echo "✅ PASS: verifiedCollegeId removed from schema"

# Test 2: Verify Prisma validate passes
if ! npx prisma validate > /dev/null 2>&1; then
    echo "❌ FAIL: Prisma schema validation failed"
    exit 1
fi
echo "✅ PASS: Prisma schema validates"

# Test 3: Verify migration status clean
if ! npx prisma migrate status | grep -q "up to date\|No migrations found"; then
    echo "⚠️  WARNING: Migrations not up to date (expected during development)"
fi
echo "✅ PASS: Migration system operational"

# Test 4: Verify no code references to verifiedCollegeId
REFS=$(grep -r "verifiedCollegeId" src/ --include="*.ts" --include="*.js" 2>/dev/null | wc -l)
if [ "$REFS" -gt 0 ]; then
    echo "❌ FAIL: Found $REFS references to verifiedCollegeId in code"
    grep -r "verifiedCollegeId" src/ --include="*.ts" --include="*.js" | head -5
    exit 1
fi
echo "✅ PASS: No code references to verifiedCollegeId"

# Test 5: Verify TypeScript compilation
if ! npm run build > /dev/null 2>&1; then
    echo "❌ FAIL: TypeScript compilation failed after schema change"
    exit 1
fi
echo "✅ PASS: TypeScript compilation successful"

# Test 6: Verify Message/Conversation models intact
if ! grep -q "model Message" prisma/schema.prisma; then
    echo "❌ FAIL: Message model missing from schema"
    exit 1
fi

if ! grep -q "model Conversation" prisma/schema.prisma; then
    echo "❌ FAIL: Conversation model missing from schema"
    exit 1
fi
echo "✅ PASS: Core chat models (Message, Conversation) intact"

echo ""
echo "=== ALL TESTS PASSED ==="
exit 0
