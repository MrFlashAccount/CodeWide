/** Structured log boundary; the original Error remains owned by the caller. */
export type DiagnosticLogInput = {
  readonly err: Error | null;
  readonly event: string;
  readonly fields: Readonly<Record<string, boolean | number | string | null>>;
  readonly level: "debug" | "error" | "fatal" | "info" | "warn";
  readonly occurredAtUnixMs: number;
};

/** Serializes every stack frame and cause, without a character or depth cutoff. */
export function diagnosticLogJson(record: DiagnosticLogInput): string {
  return JSON.stringify({
    err:
      record.err === null
        ? null
        : {
            causes: errorCauses(record.err),
            message: record.err.message,
            name: record.err.name,
            nativeStack: nativeErrorStack(record.err),
            stack: record.err.stack ?? "",
          },
    event: record.event,
    fields: record.fields,
    level: record.level,
    occurredAtUnixMs: record.occurredAtUnixMs,
    source: "javascript",
  });
}

function errorCauses(error: Error): readonly SerializedCause[] {
  const seen = new Set<Error>();
  const causes: SerializedCause[] = [];
  let current: Error | null = error;
  while (current !== null) {
    if (seen.has(current)) {
      break;
    }
    seen.add(current);
    if (current !== error) {
      causes.push({
        message: current.message,
        name: current.name,
        nativeStack: nativeErrorStack(current),
        stack: current.stack ?? "",
      });
    }
    const cause = readProperty(current, "cause");
    current = cause instanceof Error ? cause : null;
  }
  return causes;
}

type SerializedCause = {
  readonly message: string;
  readonly name: string;
  readonly nativeStack: string;
  readonly stack: string;
};

function nativeErrorStack(error: Error): string {
  const nativeFrames = readProperty(error, "nativeStackAndroid");
  if (!Array.isArray(nativeFrames)) {
    return "";
  }
  const parts: string[] = [];
  const frames: readonly unknown[] = nativeFrames;
  for (const frame of frames) {
    if (typeof frame !== "object" || frame === null) {
      continue;
    }
    const fields: string[] = [];
    for (const key of ["class", "methodName", "file", "lineNumber"] as const) {
      const value = readProperty(frame, key);
      if (typeof value === "string" || typeof value === "number") {
        fields.push(`${key}=${String(value)}`);
      }
    }
    parts.push(fields.join(" "));
  }
  return parts.join("\n");
}

function readProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}
