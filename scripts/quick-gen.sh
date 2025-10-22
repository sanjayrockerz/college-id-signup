#!/bin/bash
# Quick Dataset Generation Wrapper
# Simplifies synthetic dataset generation with common defaults

set -e

# Parse arguments
BAND=${1:-dev}
SEED=${2:-"${BAND}_$(date +%Y%m%d)_$(openssl rand -hex 4)"}
DRY_RUN=${DRY_RUN:-false}

if [ "$BAND" != "dev" ] && [ "$BAND" != "staging" ] && [ "$BAND" != "perf" ]; then
  echo "Usage: ./quick-gen.sh <dev|staging|perf> [seed]"
  echo ""
  echo "Examples:"
  echo "  ./quick-gen.sh dev"
  echo "  ./quick-gen.sh staging staging_20251022_baseline"
  echo "  DRY_RUN=true ./quick-gen.sh perf"
  exit 1
fi

echo "=== Quick Dataset Generation ==="
echo "Band: $BAND"
echo "Seed: $SEED"
echo ""

# Environment check
if [ "$NODE_ENV" = "production" ]; then
  echo "FATAL: Cannot generate synthetic data on production"
  exit 1
fi

# Estimate resources
case $BAND in
  dev)
    MESSAGES="5M"
    USERS="5k"
    DURATION="~5 min"
    ;;
  staging)
    MESSAGES="100M"
    USERS="150k"
    DURATION="~45 min"
    ;;
  perf)
    MESSAGES="300M+"
    USERS="250k"
    DURATION="~2 hours"
    ;;
esac

echo "Expected output:"
echo "  Messages: $MESSAGES"
echo "  Users: $USERS"
echo "  Estimated time: $DURATION"
echo ""

if [ "$DRY_RUN" = "true" ]; then
  echo "[DRY RUN] Would execute:"
  echo "  ts-node scripts/synthetic-data/generator.ts --band $BAND --seed $SEED"
  exit 0
fi

# Confirm for large datasets
if [ "$BAND" = "perf" ]; then
  echo "WARNING: Perf band generation takes ~2 hours and produces 300M+ rows"
  read -p "Continue? (yes/no): " confirm
  if [ "$confirm" != "yes" ]; then
    echo "Aborted"
    exit 0
  fi
fi

# Generate
cd scripts/synthetic-data
ts-node generator.ts --band "$BAND" --seed "$SEED"

# Report
LATEST_REPORT=$(ls -t report_${BAND}_*.json 2>/dev/null | head -n1)
if [ -n "$LATEST_REPORT" ]; then
  echo ""
  echo "=== Generation Complete ==="
  jq '{band, seed: "stored_separately", counts, generated_at}' "$LATEST_REPORT"
  echo ""
  echo "Report: $LATEST_REPORT"
  echo "Seed: $SEED (store this for reproducibility)"
  
  # Archive seed
  mkdir -p seeds
  echo "$SEED" > "seeds/${BAND}_$(date +%Y%m%d).txt"
  echo "Seed archived: seeds/${BAND}_$(date +%Y%m%d).txt"
fi
