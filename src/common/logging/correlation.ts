import { randomUUID } from "crypto";

function coerceToString(input: unknown): string | undefined {
  if (input === undefined || input === null) {
    return undefined;
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (Array.isArray(input)) {
    return coerceToString(input[0]);
  }

  return undefined;
}

export function resolveCorrelationId(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    const value = coerceToString(candidate);
    if (value) {
      return value.slice(0, 64);
    }
  }

  return randomUUID();
}
