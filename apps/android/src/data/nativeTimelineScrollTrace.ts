const GEOMETRY_PHASES = [
  "attach",
  "detach",
  "draw",
  "layout",
  "scroll",
  "drag-start",
  "drag-end",
  "momentum-start",
  "momentum-end",
] as const;
const MAX_CAPTURES = 4;
const MAX_CAPTURE_ENTRIES = 160;
const MAX_LIVE_ENTRIES = 240;
type GeometryPhase = (typeof GEOMETRY_PHASES)[number];

type TraceClock = {
  readonly sequence: number;
  readonly unixMs: number;
  readonly uptimeMs: number;
};

type GeometryEntry = TraceClock & {
  readonly alpha: number;
  readonly contentAlpha: number;
  readonly contentChildren: number;
  readonly contentHeightPx: number;
  readonly imeBottomPx: number;
  readonly kind: "geometry";
  readonly offsetPx: number;
  readonly phase: GeometryPhase;
  readonly shown: boolean;
  readonly viewportHeightPx: number;
  readonly viewTag: number;
};

type FrameEntry = TraceClock & {
  readonly deadlineMs: number;
  readonly drawMs: number;
  readonly droppedReports: number;
  readonly durationMs: number;
  readonly gpuMs: number;
  readonly kind: "frame";
  readonly layoutMs: number;
  readonly uiDelayMs: number;
};

type TraceEntry = GeometryEntry | FrameEntry;

/** Local-only native evidence, with frozen before/after windows around position discontinuities. */
export interface NativeTimelineScrollTrace {
  readonly captures: readonly {
    readonly entries: readonly TraceEntry[];
    readonly triggerSequence: number;
  }[];
  readonly drawCount: number;
  readonly entries: readonly TraceEntry[];
  readonly evicted: number;
  readonly evictedCaptures: number;
  readonly frameCount: number;
  readonly geometryCount: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function count(value: unknown): value is number {
  return finite(value) && Number.isSafeInteger(value) && value >= 0;
}

function measurement(value: unknown): value is number {
  return finite(value) && value >= -1;
}

function opacity(value: unknown): value is number {
  return finite(value) && value >= 0 && value <= 1;
}

function phase(value: unknown): value is GeometryPhase {
  const names: readonly string[] = GEOMETRY_PHASES;
  return typeof value === "string" && names.includes(value);
}

function clock(value: Record<string, unknown>): value is Record<string, unknown> & TraceClock {
  return count(value.sequence) && count(value.unixMs) && count(value.uptimeMs);
}

type ViewGeometry = Pick<
  GeometryEntry,
  "contentHeightPx" | "imeBottomPx" | "offsetPx" | "viewportHeightPx" | "viewTag"
>;
type ViewAppearance = Pick<GeometryEntry, "alpha" | "contentAlpha" | "contentChildren" | "shown">;

function hasViewGeometry(
  entry: Record<string, unknown>,
): entry is Record<string, unknown> & ViewGeometry {
  return (
    count(entry.contentHeightPx) &&
    measurement(entry.imeBottomPx) &&
    finite(entry.offsetPx) &&
    count(entry.viewTag) &&
    count(entry.viewportHeightPx)
  );
}

function hasAppearance(
  entry: Record<string, unknown>,
): entry is Record<string, unknown> & ViewAppearance {
  return (
    opacity(entry.alpha) &&
    opacity(entry.contentAlpha) &&
    count(entry.contentChildren) &&
    typeof entry.shown === "boolean"
  );
}

function parseGeometry(entry: Record<string, unknown> & TraceClock): GeometryEntry | null {
  if (!hasViewGeometry(entry) || !hasAppearance(entry) || !phase(entry.phase)) {
    return null;
  }
  return {
    alpha: entry.alpha,
    contentAlpha: entry.contentAlpha,
    contentChildren: entry.contentChildren,
    contentHeightPx: entry.contentHeightPx,
    imeBottomPx: entry.imeBottomPx,
    kind: "geometry",
    offsetPx: entry.offsetPx,
    phase: entry.phase,
    sequence: entry.sequence,
    shown: entry.shown,
    unixMs: entry.unixMs,
    uptimeMs: entry.uptimeMs,
    viewportHeightPx: entry.viewportHeightPx,
    viewTag: entry.viewTag,
  };
}

function parseFrame(entry: Record<string, unknown> & TraceClock): FrameEntry | null {
  if (
    !measurement(entry.deadlineMs) ||
    !measurement(entry.drawMs) ||
    !count(entry.droppedReports) ||
    !measurement(entry.durationMs) ||
    !measurement(entry.gpuMs) ||
    !measurement(entry.layoutMs) ||
    !measurement(entry.uiDelayMs)
  ) {
    return null;
  }
  return {
    deadlineMs: entry.deadlineMs,
    drawMs: entry.drawMs,
    droppedReports: entry.droppedReports,
    durationMs: entry.durationMs,
    gpuMs: entry.gpuMs,
    kind: "frame",
    layoutMs: entry.layoutMs,
    sequence: entry.sequence,
    uiDelayMs: entry.uiDelayMs,
    unixMs: entry.unixMs,
    uptimeMs: entry.uptimeMs,
  };
}

function parseEntry(value: unknown): TraceEntry | null {
  if (!record(value) || !clock(value)) {
    return null;
  }
  switch (value.kind) {
    case "geometry":
      return parseGeometry(value);
    case "frame":
      return parseFrame(value);
    default:
      return null;
  }
}

function parseEntries(input: unknown, maximum: number): readonly TraceEntry[] | null {
  if (!Array.isArray(input) || input.length > maximum) {
    return null;
  }
  const entries: TraceEntry[] = [];
  for (const value of input) {
    const entry = parseEntry(value);
    if (entry === null) {
      return null;
    }
    entries.push(entry);
  }
  return entries;
}

function parseCaptures(input: unknown): NativeTimelineScrollTrace["captures"] | null {
  if (!Array.isArray(input) || input.length > MAX_CAPTURES) {
    return null;
  }
  const captures: { entries: readonly TraceEntry[]; triggerSequence: number }[] = [];
  for (const value of input) {
    if (!record(value) || !count(value.triggerSequence)) {
      return null;
    }
    const entries = parseEntries(value.entries, MAX_CAPTURE_ENTRIES);
    if (entries === null) {
      return null;
    }
    captures.push({ entries, triggerSequence: value.triggerSequence });
  }
  return captures;
}

/** Adapts bounded native DTOs and removes undeclared text at every nesting level. */
export function parseNativeTimelineScrollTrace(input: unknown): NativeTimelineScrollTrace | null {
  if (!record(input)) {
    return null;
  }
  return parseTrace(input);
}

function parseTrace(trace: Record<string, unknown>): NativeTimelineScrollTrace | null {
  if (
    !count(trace.drawCount) ||
    !count(trace.evicted) ||
    !count(trace.evictedCaptures) ||
    !count(trace.frameCount) ||
    !count(trace.geometryCount)
  ) {
    return null;
  }
  const entries = parseEntries(trace.entries, MAX_LIVE_ENTRIES);
  const captures = parseCaptures(trace.captures);
  if (entries === null || captures === null) {
    return null;
  }
  return {
    captures,
    drawCount: trace.drawCount,
    entries,
    evicted: trace.evicted,
    evictedCaptures: trace.evictedCaptures,
    frameCount: trace.frameCount,
    geometryCount: trace.geometryCount,
  };
}
