#!/bin/bash
# Calibrate Distribution Spec from Production Metrics
# Updates distribution-spec.json with actual production-sampled values

set -e

if [ $# -ne 2 ]; then
  echo "Usage: ./calibrate-spec.sh <production-metrics.json> <output-spec.json>"
  exit 1
fi

PROD_METRICS=$1
OUTPUT_SPEC=$2

if [ ! -f "$PROD_METRICS" ]; then
  echo "Error: Production metrics file not found: $PROD_METRICS"
  exit 1
fi

echo "=== Calibrating Distribution Spec ==="
echo "Input: $PROD_METRICS"
echo "Output: $OUTPUT_SPEC"
echo ""

# Read base spec
BASE_SPEC="scripts/synthetic-data/distribution-spec.json"

if [ ! -f "$BASE_SPEC" ]; then
  echo "Error: Base spec not found: $BASE_SPEC"
  exit 1
fi

# Extract production metrics
MEDIA_RATIO=$(jq -r '.messages.media_ratio' "$PROD_METRICS")
P50_MESSAGES=$(jq -r '.conversations.activity_percentiles.p50' "$PROD_METRICS")
P95_MESSAGES=$(jq -r '.conversations.activity_percentiles.p95' "$PROD_METRICS")
P99_MESSAGES=$(jq -r '.conversations.activity_percentiles.p99' "$PROD_METRICS")
BURST_COEFF=$(jq -r '.messages.burst_coefficient' "$PROD_METRICS")
WEEKDAY_WEEKEND=$(jq -r '.messages.weekday_weekend_ratio' "$PROD_METRICS")

echo "[Extracted] Production metrics:"
echo "  Media ratio: $MEDIA_RATIO"
echo "  Conversation message p50: $P50_MESSAGES"
echo "  Conversation message p95: $P95_MESSAGES"
echo "  Conversation message p99: $P99_MESSAGES"
echo "  Burst coefficient: $BURST_COEFF"
echo "  Weekday/weekend ratio: $WEEKDAY_WEEKEND"
echo ""

# Calculate content length distribution parameters from histogram
# This is a simplified approach; production would use statistical fitting
CONTENT_LENGTH_SAMPLES=$(jq -r '.messages.content_length_histogram | to_entries | map("\(.key):\(.value)") | join(" ")' "$PROD_METRICS")
echo "[Info] Content length histogram: $CONTENT_LENGTH_SAMPLES"

# Update spec with production values
jq --argjson media_ratio "$MEDIA_RATIO" \
   --argjson p50 "$P50_MESSAGES" \
   --argjson p95 "$P95_MESSAGES" \
   --argjson p99 "$P99_MESSAGES" \
   --argjson burst "$BURST_COEFF" \
   --argjson weekday_ratio "$WEEKDAY_WEEKEND" '
  .messages.content.media_ratio = $media_ratio |
  .messages.per_conversation_distribution.median_target = ($p50 | floor) |
  .messages.per_conversation_distribution.p95_target = ($p95 | floor) |
  .messages.inter_arrival.burst_coefficient = $burst |
  .temporal_patterns.diurnal_cycle.weekday_boost = $weekday_ratio |
  .metadata = {
    calibrated_from: "production_metrics",
    calibrated_at: (now | strftime("%Y-%m-%dT%H:%M:%SZ")),
    source_window_days: 30,
    confidence: "high"
  }
' "$BASE_SPEC" > "$OUTPUT_SPEC"

echo "✓ Calibrated spec written to: $OUTPUT_SPEC"
echo ""
echo "=== Calibration Summary ==="
echo "Base spec: $BASE_SPEC"
echo "Production metrics: $PROD_METRICS"
echo "Calibrated spec: $OUTPUT_SPEC"
echo ""
echo "Next steps:"
echo "1. Review $OUTPUT_SPEC for accuracy"
echo "2. Update scripts/synthetic-data/distribution-spec.json if satisfied"
echo "3. Regenerate datasets with calibrated parameters"
