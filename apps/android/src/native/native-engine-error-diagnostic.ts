const MAX_NATIVE_ERROR_DIAGNOSTIC_CHARS = 8_000;

/** Preserves the original native-engine failure without trusting Error fields. */
export function nativeEngineErrorDiagnostic(cause: unknown, fallback: string): string {
  if (typeof cause === "string") return boundedNonEmpty(cause, fallback);
  if (cause === null || (typeof cause !== "object" && typeof cause !== "function")) return fallback;

  const message = readableStringProperty(cause, "message");
  const name = readableStringProperty(cause, "name");
  const stack = readableStringProperty(cause, "stack");
  const summary = message === ""
    ? name === "" || name === "Error" ? fallback : name
    : name === "" || name === "Error" ? message : `${name}: ${message}`;
  const diagnostic = stack === "" || stack === message || stack === summary
    ? summary
    : `${summary}\n\nJavaScript stack:\n${stack}`;
  return diagnostic.slice(0, MAX_NATIVE_ERROR_DIAGNOSTIC_CHARS);
}

function readableStringProperty(value: object, key: string): string {
  try {
    const property = Reflect.get(value, key);
    return typeof property === "string" ? property.trim() : "";
  } catch {
    return "";
  }
}

function boundedNonEmpty(value: string, fallback: string): string {
  const normalized = value.trim();
  return normalized === "" ? fallback : normalized.slice(0, MAX_NATIVE_ERROR_DIAGNOSTIC_CHARS);
}
