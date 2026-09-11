const MAX_REPORT_CHARS = 64_000;
const MAX_CAUSES = 6;
const MAX_NATIVE_FRAMES = 120;

/** Local, explicitly copied diagnostics only. May contain private paths; never send as telemetry. */
export function errorDiagnostic(title: string, cause: unknown): string {
  const parts = [`CodeWide error: ${title}`, `Occurred at: ${new Date().toISOString()}`];
  const seen = new Set<object>();
  let current = cause;
  for (let depth = 0; depth < MAX_CAUSES; depth += 1) {
    if (depth > 0) parts.push("Caused by:");
    if (typeof current === "string") {
      parts.push(current.slice(0, MAX_REPORT_CHARS));
      break;
    }
    if (current === null || typeof current !== "object") {
      parts.push("No error details available");
      break;
    }
    if (seen.has(current)) {
      parts.push("[Circular cause]");
      break;
    }
    seen.add(current);
    for (const key of ["name", "message", "code", "stack"] as const) {
      const value = readProperty(current, key);
      if (typeof value === "string") parts.push(`${key}: ${value.slice(0, MAX_REPORT_CHARS)}`);
      else if (typeof value === "number") parts.push(`${key}: ${value}`);
    }
    const frames = readProperty(current, "nativeStackAndroid");
    if (Array.isArray(frames)) {
      parts.push("Android native stack:");
      for (let index = 0; index < Math.min(frames.length, MAX_NATIVE_FRAMES); index += 1) {
        const frame: unknown = frames[index];
        if (frame === null || typeof frame !== "object") continue;
        const fields: string[] = [];
        for (const key of ["class", "methodName", "file", "lineNumber"] as const) {
          const value = readProperty(frame, key);
          if (typeof value === "string") fields.push(`${key}=${value.slice(0, 2_000)}`);
          else if (typeof value === "number") fields.push(`${key}=${value}`);
        }
        parts.push(fields.join(" "));
      }
      if (frames.length > MAX_NATIVE_FRAMES) parts.push("[Native stack truncated]");
    }
    current = readProperty(current, "cause");
    if (current === undefined) break;
    if (depth === MAX_CAUSES - 1) parts.push("[Cause chain truncated]");
  }
  const report = parts.join("\n\n");
  return report.length <= MAX_REPORT_CHARS
    ? report
    : `${report.slice(0, MAX_REPORT_CHARS)}\n[Report truncated]`;
}

function readProperty(value: object, key: string): unknown {
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}
