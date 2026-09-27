import {
  type NativeTimelineScrollTrace,
  parseNativeTimelineScrollTrace,
} from "./nativeTimelineScrollTrace";

const DETAILED_REPORT_VERSION = 2;
const MAX_BUILD_VERSION_LENGTH = 80;
const MAX_TRACKED_VIEWS = 4;

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
export type NativeTimelineScrollReport = {
  readonly evicted: number;
  readonly incidents: readonly NativeScrollIncident[];
} & (
  | { readonly version: 1 }
  | {
      readonly appBuild: number;
      readonly appVersion: string;
      readonly density: number;
      readonly listening: boolean;
      readonly trace: NativeTimelineScrollTrace;
      readonly trackedViews: number;
      readonly version: typeof DETAILED_REPORT_VERSION;
    }
);

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
    !supportedVersion(input.version) ||
    !nonnegativeInteger(input.evicted) ||
    !Array.isArray(input.incidents)
  ) {
    return null;
  }
  const incidents = parseIncidents(input.incidents);
  if (incidents === null) {
    return null;
  }
  if (input.version === DETAILED_REPORT_VERSION) {
    return parseDetailedReport(input, incidents, input.evicted);
  }
  return {
    evicted: input.evicted,
    incidents,
    version: 1,
  };
}

function supportedVersion(value: unknown): boolean {
  return value === 1 || value === DETAILED_REPORT_VERSION;
}

function parseIncidents(input: readonly unknown[]): readonly NativeScrollIncident[] | null {
  if (input.length > MAX_INCIDENTS) {
    return null;
  }
  const incidents: NativeScrollIncident[] = [];
  for (const value of input) {
    const incident = parseIncident(value);
    if (incident === null) {
      return null;
    }
    incidents.push(incident);
  }
  return incidents;
}

function buildVersion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_BUILD_VERSION_LENGTH &&
    /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(value)
  );
}

function parseDetailedReport(
  input: Record<string, unknown>,
  incidents: readonly NativeScrollIncident[],
  evicted: number,
): NativeTimelineScrollReport | null {
  if (
    !nonnegativeInteger(input.appBuild) ||
    !buildVersion(input.appVersion) ||
    !nonnegative(input.density) ||
    typeof input.listening !== "boolean" ||
    !nonnegativeInteger(input.trackedViews) ||
    input.trackedViews > MAX_TRACKED_VIEWS
  ) {
    return null;
  }
  const trace = parseNativeTimelineScrollTrace(input.trace);
  if (trace === null) {
    return null;
  }
  return {
    appBuild: input.appBuild,
    appVersion: input.appVersion,
    density: input.density,
    evicted,
    incidents,
    listening: input.listening,
    trace,
    trackedViews: input.trackedViews,
    version: DETAILED_REPORT_VERSION,
  };
}
