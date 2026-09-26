type NativeScrollSource =
  | "content-offset-prop"
  | "visible-content-adjustment"
  | "keyboard"
  | "worklet-scroll"
  | "scroll-command"
  | "layout-clamp"
  | "native-motion"
  | "unknown";

interface NativeScrollGeometry {
  readonly contentHeightPx: number;
  readonly elapsedMs: number;
  readonly fromOffsetPx: number;
  readonly toOffsetPx: number;
  readonly unixMs: number;
  readonly viewportHeightPx: number;
}

interface NativeScrollIncident extends NativeScrollGeometry {
  readonly source: NativeScrollSource;
  readonly stack: readonly string[];
  readonly viewTag: number;
}

/** Bounded native call-site evidence; an observed jump is not automatically a bug. */
export interface NativeTimelineScrollReport {
  readonly evicted: number;
  readonly incidents: readonly NativeScrollIncident[];
  readonly version: 1;
}

const MAX_INCIDENTS = 12;
const MAX_STACK_FRAMES = 32;
const MAX_FRAME_LENGTH = 240;
const MAX_JUMP_ELAPSED_MS = 300;

function record(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === "object" && !Array.isArray(input);
}

function finite(input: unknown): input is number {
  return typeof input === "number" && Number.isFinite(input);
}

function nonnegative(input: unknown): input is number {
  return finite(input) && input >= 0;
}

function nonnegativeInteger(input: unknown): input is number {
  return nonnegative(input) && Number.isSafeInteger(input);
}

function source(input: unknown): input is NativeScrollSource {
  return (
    input === "content-offset-prop" ||
    input === "visible-content-adjustment" ||
    input === "keyboard" ||
    input === "worklet-scroll" ||
    input === "scroll-command" ||
    input === "layout-clamp" ||
    input === "native-motion" ||
    input === "unknown"
  );
}

function frameworkStack(input: unknown): input is readonly string[] {
  return (
    Array.isArray(input) &&
    input.length <= MAX_STACK_FRAMES &&
    input.every(
      (frame: unknown) =>
        typeof frame === "string" &&
        frame.length <= MAX_FRAME_LENGTH &&
        /^(?:android\.(?:view|widget)|com\.facebook\.react|com\.swmansion\.reanimated|com\.reactnativekeyboardcontroller)\.[\w.$]+:-?\d+$/.test(
          frame,
        ),
    )
  );
}

function hasGeometry(
  input: Record<string, unknown>,
): input is Record<string, unknown> & NativeScrollGeometry {
  return (
    nonnegative(input.contentHeightPx) &&
    nonnegative(input.elapsedMs) &&
    input.elapsedMs <= MAX_JUMP_ELAPSED_MS &&
    finite(input.fromOffsetPx) &&
    finite(input.toOffsetPx) &&
    nonnegative(input.unixMs) &&
    nonnegative(input.viewportHeightPx)
  );
}

function parseIncident(input: unknown): NativeScrollIncident | null {
  if (
    !record(input) ||
    !hasGeometry(input) ||
    !source(input.source) ||
    !frameworkStack(input.stack) ||
    !nonnegativeInteger(input.viewTag)
  ) {
    return null;
  }
  return {
    contentHeightPx: input.contentHeightPx,
    elapsedMs: input.elapsedMs,
    fromOffsetPx: input.fromOffsetPx,
    source: input.source,
    stack: input.stack,
    toOffsetPx: input.toOffsetPx,
    unixMs: input.unixMs,
    viewportHeightPx: input.viewportHeightPx,
    viewTag: input.viewTag,
  };
}

/** Validates the native boundary and discards undeclared fields before explicit report export. */
export function parseNativeTimelineScrollReport(input: unknown): NativeTimelineScrollReport | null {
  if (
    !record(input) ||
    input.version !== 1 ||
    !nonnegativeInteger(input.evicted) ||
    !Array.isArray(input.incidents) ||
    input.incidents.length > MAX_INCIDENTS
  ) {
    return null;
  }
  const incidents: NativeScrollIncident[] = [];
  for (const value of input.incidents) {
    const incident = parseIncident(value);
    if (incident === null) {
      return null;
    }
    incidents.push(incident);
  }
  return {
    evicted: input.evicted,
    incidents,
    version: 1,
  };
}
