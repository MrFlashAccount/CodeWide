/** Local, explicitly copied diagnostics only. May contain private paths; never send as telemetry. */
export function errorDiagnostic(title: string, cause: unknown): string {
  const parts = [`CodeWide error: ${title}`, `Occurred at: ${new Date().toISOString()}`];
  const seen = new Set<unknown>();
  let current = cause;
  for (let depth = 0; ; depth += 1) {
    if (depth > 0) {
      parts.push("Caused by:");
    }
    if (typeof current === "string") {
      parts.push(current);
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
      if (typeof value === "string") {
        parts.push(`${key}: ${value}`);
      } else if (typeof value === "number") {
        parts.push(`${key}: ${String(value)}`);
      }
    }
    const frames = readProperty(current, "nativeStackAndroid");
    if (Array.isArray(frames)) {
      parts.push("Android native stack:");
      const nativeFrames: readonly unknown[] = frames;
      for (const frame of nativeFrames) {
        if (frame === null || typeof frame !== "object") {
          continue;
        }
        const fields: string[] = [];
        for (const key of ["class", "methodName", "file", "lineNumber"] as const) {
          const value = readProperty(frame, key);
          if (typeof value === "string") {
            fields.push(`${key}=${value}`);
          } else if (typeof value === "number") {
            fields.push(`${key}=${String(value)}`);
          }
        }
        parts.push(fields.join(" "));
      }
    }
    current = readProperty(current, "cause");
    if (current === undefined) {
      break;
    }
  }
  return parts.join("\n\n");
}

function readProperty(value: unknown, key: string): unknown {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return undefined;
  }
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}
