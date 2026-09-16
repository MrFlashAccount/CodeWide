/** Narrows untrusted object input without granting array or null semantics. */
function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Returns one validated record boundary or `null` for every other runtime shape. */
export function unknownRecord(value: unknown): Record<string, unknown> | null {
  return isUnknownRecord(value) ? value : null;
}
