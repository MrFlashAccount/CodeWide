/** V1 protocolValue owner, extracted without changing interaction or resource lifetime. */

export function recordValue(value: unknown): Record<string, unknown> {
  return isProtocolRecord(value) ? value : {};
}

export function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A record keeps its validated source identity; all field reads remain unknown. */
export function isProtocolRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
