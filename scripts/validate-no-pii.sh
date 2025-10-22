#!/bin/bash
# PII Validation Script
# Scans exported artifacts for personally identifiable information
# Returns exit code 1 if PII detected

set -e

if [ $# -eq 0 ]; then
  echo "Usage: ./validate-no-pii.sh <file1.json> [file2.json ...]"
  exit 1
fi

FAILED=0

for file in "$@"; do
  echo "=== Scanning: $file ==="
  
  if [ ! -f "$file" ]; then
    echo "✗ File not found: $file"
    FAILED=1
    continue
  fi
  
  # Check for email addresses
  if grep -qE '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' "$file"; then
    echo "✗ Email addresses detected"
    grep -oE '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' "$file" | head -n 5
    FAILED=1
  else
    echo "✓ No email addresses"
  fi
  
  # Check for personal names (basic heuristic)
  if grep -qE '\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b' "$file"; then
    echo "✗ Potential personal names detected"
    grep -oE '\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b' "$file" | head -n 5
    FAILED=1
  else
    echo "✓ No personal names"
  fi
  
  # Check for phone numbers
  if grep -qE '(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}' "$file"; then
    echo "✗ Phone numbers detected"
    grep -oE '(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}' "$file" | head -n 5
    FAILED=1
  else
    echo "✓ No phone numbers"
  fi
  
  # Check for credit card numbers (basic)
  if grep -qE '\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b' "$file"; then
    echo "✗ Potential credit card numbers detected"
    FAILED=1
  else
    echo "✓ No credit card numbers"
  fi
  
  # Check for SSNs
  if grep -qE '\b\d{3}-\d{2}-\d{4}\b' "$file"; then
    echo "✗ Potential SSNs detected"
    FAILED=1
  else
    echo "✓ No SSNs"
  fi
  
  # Check for IP addresses (optional, may be acceptable)
  if grep -qE '\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b' "$file"; then
    echo "⚠ IP addresses found (review required)"
  fi
  
  # Validate token format (should be 16-char hex)
  if jq -e '.deterministic_id_mapping.sample_token_format' "$file" >/dev/null 2>&1; then
    token_sample=$(jq -r '.deterministic_id_mapping.sample_token_format' "$file" | cut -d' ' -f1)
    if [[ ! "$token_sample" =~ ^[a-f0-9]{16}$ ]]; then
      echo "✗ Token format invalid (expected 16 hex chars): $token_sample"
      FAILED=1
    else
      echo "✓ Token format valid (HMAC truncated)"
    fi
  fi
  
  # Check for plaintext message content (long strings)
  max_string_length=$(jq -r 'paths(type=="string") as $p | getpath($p) | length' "$file" | sort -nr | head -n1)
  if [ "$max_string_length" -gt 200 ]; then
    echo "✗ Suspiciously long strings detected (max: $max_string_length chars)"
    FAILED=1
  else
    echo "✓ No long plaintext strings (max: $max_string_length chars)"
  fi
  
  echo ""
done

if [ $FAILED -eq 1 ]; then
  echo "=== PII VALIDATION FAILED ==="
  echo "Manual review required before release"
  exit 1
else
  echo "=== PII VALIDATION PASSED ==="
  echo "No PII detected in scanned files"
  exit 0
fi
