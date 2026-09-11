import { recordOperationalTelemetryEvent } from "./telemetry";
import { parseWindowFrameSample } from "./window-frame-report";

interface FrameContext {
  connectionId: string;
  threadId: string;
  requestId: string;
  selectedAtUnixMs: number;
}

const contexts: FrameContext[] = [];

/** Correlate delayed native reports with their original destination, not the current chat. */
export function recordFrameContext(connectionId: string, threadId: string, requestId: string): void {
  contexts.push({ connectionId, threadId, requestId, selectedAtUnixMs: Date.now() });
  if (contexts.length > 128) contexts.shift();
}

export function hasFrameContext(): boolean {
  return contexts.length > 0;
}

function contextAt(timestamp: number): FrameContext | undefined {
  return contexts.findLast((context) => context.selectedAtUnixMs <= timestamp);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Only explicitly allowed numeric fields cross the native diagnostics boundary. */
export function publishFrameIncidents(input: unknown): void {
  if (!isRecord(input) || !Array.isArray(input.windows)) return;
  for (const raw of input.windows.slice(0, 120)) {
    const sample = parseWindowFrameSample(raw);
    if (sample === null) continue;
    const { values } = sample;
    const endAt = values.windowEndUnixMs;
    if (endAt === undefined) continue;
    const context = contextAt(endAt);
    if (context === undefined) continue;
    values.deliveryDelayMs = Math.max(0, Date.now() - endAt);
    if (sample.appBuild !== null) values.appBuild = sample.appBuild;
    recordOperationalTelemetryEvent(context.connectionId, {
      name: sample.activity === "scroll" ? "ui.scroll_window" : "ui.frame_incident",
      connectionId: context.connectionId,
      threadId: context.threadId,
      requestId: context.requestId,
      values,
      tags: { source: "android_frame_metrics", attribution: "last_selection_at_window_end", surface: sample.surface, activity: sample.activity },
    });
  }
  const context = contexts.at(-1);
  if (context !== undefined && typeof input.droppedWindows === "number" && Number.isSafeInteger(input.droppedWindows) && input.droppedWindows > 0) {
    recordOperationalTelemetryEvent(context.connectionId, {
      name: "ui.frame_reports_dropped",
      values: { windows: input.droppedWindows },
    });
  }
}

/** Scheduling delay is evidence of JS unavailability, not a TBT measurement. */
export function recordJsSchedulingDelay(delayMs: number): void {
  const context = contexts.at(-1);
  if (context === undefined || !Number.isFinite(delayMs) || delayMs < 50) return;
  recordOperationalTelemetryEvent(context.connectionId, {
    name: "ui.js_scheduling_delay",
    threadId: context.threadId,
    requestId: context.requestId,
    values: { delayMs },
    tags: { source: "foreground_timer", attribution: "last_selection" },
  });
}

export function resetFrameContextsForTests(): void {
  contexts.length = 0;
}
