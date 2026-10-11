/**
 * Conversion of parsed SDK values to the protocol's `JsonValue`. Tool inputs
 * and tool results come from the CLI's JSON output; values JSON cannot carry
 * (`undefined`, functions, non-finite numbers) become `null`. Pure.
 */

import type { JsonValue } from "../protocol.js";
import { isRecord } from "./frames.js";

export function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (Array.isArray(value)) {
    return value.map(toJsonValue);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toJsonValue(entry)]),
    );
  }
  return null;
}
