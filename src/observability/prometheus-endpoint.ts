import type { Request, Response } from "express";
import { TelemetryMetrics } from "./metrics-registry";

const METRICS_CACHE_CONTROL = "no-store, max-age=0";

export async function prometheusMetricsHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  TelemetryMetrics.refreshEnvironment();
  const registry = TelemetryMetrics.registry();

  res.setHeader("Content-Type", registry.contentType);
  res.setHeader("Cache-Control", METRICS_CACHE_CONTROL);
  res.send(await registry.metrics());
}
