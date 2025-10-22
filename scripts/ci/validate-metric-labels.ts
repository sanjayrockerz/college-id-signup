#!/usr/bin/env ts-node

import { TelemetryMetrics } from "../../src/observability/metrics-registry";

const ALLOWED_LABELS = new Set(["environment", "event", "endpoint", "type"]);
const MAX_LABELS_PER_METRIC = 2;

function main(): void {
  const violations: string[] = [];
  const descriptors = TelemetryMetrics.describe();

  descriptors.forEach(({ name, labelNames }) => {
    if (labelNames.length > MAX_LABELS_PER_METRIC) {
      violations.push(
        `${name}: has ${labelNames.length} labels (limit ${MAX_LABELS_PER_METRIC})`,
      );
    }

    labelNames.forEach((label) => {
      if (!ALLOWED_LABELS.has(label)) {
        violations.push(`${name}: label "${label}" is not allowed`);
      }
    });
  });

  if (violations.length > 0) {
    console.error("Metric label policy violations detected:\n");
    violations.forEach((violation) => console.error(` - ${violation}`));
    console.error(
      "\nSee docs/observability/label-policy.md for approved labels.",
    );
    process.exit(1);
  }

  console.log("Metric label policy check passed ✔");
}

main();
