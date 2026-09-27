import type {
  TimelineLibraryScrollAdjustment,
  TimelineLibraryScrollCommand,
} from "./timelineScrollDiagnosticContract";

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nullableFinite(value: unknown): value is number | null {
  return value === null || finite(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type CommandGeometry = Pick<
  TimelineLibraryScrollCommand,
  "contentHeightPx" | "logicalOffsetPx" | "rowCount" | "viewportHeightPx"
>;
type CommandFlags = Pick<
  TimelineLibraryScrollCommand,
  "animated" | "initial" | "initialPending" | "maintainingEnd" | "nativeCorrectionPending"
>;

function hasGeometry(
  value: Record<string, unknown>,
): value is Record<string, unknown> & CommandGeometry {
  return (
    finite(value.contentHeightPx) &&
    finite(value.logicalOffsetPx) &&
    finite(value.viewportHeightPx) &&
    finite(value.rowCount) &&
    value.rowCount >= 0 &&
    Number.isSafeInteger(value.rowCount)
  );
}

function hasFlags(value: Record<string, unknown>): value is Record<string, unknown> & CommandFlags {
  return (
    typeof value.animated === "boolean" &&
    typeof value.initial === "boolean" &&
    typeof value.initialPending === "boolean" &&
    typeof value.maintainingEnd === "boolean" &&
    typeof value.nativeCorrectionPending === "boolean"
  );
}

/** Validates the dependency-owned callback and projects only the declared diagnostic fields. */
export function parseLegendScrollDiagnostic(
  input: unknown,
): TimelineLibraryScrollCommand | TimelineLibraryScrollAdjustment | null {
  if (!record(input)) {
    return null;
  }
  return input.phase === "adjustment" ? parseAdjustment(input) : parseCommand(input);
}

function parseCommand(value: Record<string, unknown>): TimelineLibraryScrollCommand | null {
  if (
    !hasGeometry(value) ||
    !hasFlags(value) ||
    !finite(value.offsetPx) ||
    (value.phase !== "dispatch" && value.phase !== "retry")
  ) {
    return null;
  }
  return {
    animated: value.animated,
    contentHeightPx: value.contentHeightPx,
    initial: value.initial,
    initialPending: value.initialPending,
    logicalOffsetPx: value.logicalOffsetPx,
    maintainingEnd: value.maintainingEnd,
    nativeCorrectionPending: value.nativeCorrectionPending,
    offsetPx: value.offsetPx,
    phase: value.phase,
    rowCount: value.rowCount,
    viewportHeightPx: value.viewportHeightPx,
  };
}

function parseAdjustment(value: Record<string, unknown>): TimelineLibraryScrollAdjustment | null {
  if (
    !hasGeometry(value) ||
    !finite(value.clampCompensationPx) ||
    !nullableFinite(value.lastNativeOffsetPx) ||
    !nullableFinite(value.pendingDataAppliedPx) ||
    !finite(value.requestedDeltaPx) ||
    !finite(value.sentinelDeltaPx)
  ) {
    return null;
  }
  return {
    clampCompensationPx: value.clampCompensationPx,
    contentHeightPx: value.contentHeightPx,
    lastNativeOffsetPx: value.lastNativeOffsetPx,
    logicalOffsetPx: value.logicalOffsetPx,
    pendingDataAppliedPx: value.pendingDataAppliedPx,
    phase: "adjustment",
    requestedDeltaPx: value.requestedDeltaPx,
    rowCount: value.rowCount,
    sentinelDeltaPx: value.sentinelDeltaPx,
    viewportHeightPx: value.viewportHeightPx,
  };
}
