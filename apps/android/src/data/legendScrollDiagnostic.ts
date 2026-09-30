import type {
  TimelineLibraryPerformance,
  TimelineLibraryScrollAdjustment,
  TimelineLibraryScrollCommand,
} from "./timelineScrollDiagnosticContract";
import type { TimelineScrollDiagnostics } from "./timelineScrollDiagnostics";

type ParsedLegendScrollDiagnostic =
  | TimelineLibraryPerformance
  | TimelineLibraryScrollCommand
  | TimelineLibraryScrollAdjustment;
type LegendScrollDiagnosticParser = (
  value: Record<string, unknown>,
) => ParsedLegendScrollDiagnostic | null;

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
type CalculationDiagnostic = Extract<TimelineLibraryPerformance, { readonly phase: "calculate" }>;
type CalculationFlags = Pick<
  CalculationDiagnostic,
  "dataChanged" | "doMVCP" | "forceFullItemPositions"
>;
type CalculationNumbers = Pick<
  CalculationDiagnostic,
  | "durationMs"
  | "positionDurationMs"
  | "positionStartIndex"
  | "rowCount"
  | "visibleEndIndex"
  | "visibleStartIndex"
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

function hasCalculationFlags(
  value: Record<string, unknown>,
): value is Record<string, unknown> & CalculationFlags {
  return (
    typeof value.dataChanged === "boolean" &&
    typeof value.doMVCP === "boolean" &&
    typeof value.forceFullItemPositions === "boolean"
  );
}

function hasCalculationNumbers(
  value: Record<string, unknown>,
): value is Record<string, unknown> & CalculationNumbers {
  return (
    nonNegativeFinite(value.durationMs) &&
    nonNegativeFinite(value.positionDurationMs) &&
    safeIntegerAtLeast(value.positionStartIndex, -1) &&
    safeIntegerAtLeast(value.rowCount, 0) &&
    safeIntegerAtLeast(value.visibleEndIndex, -1) &&
    safeIntegerAtLeast(value.visibleStartIndex, -1)
  );
}

function parseLegendScrollDiagnostic(input: unknown): ParsedLegendScrollDiagnostic | null {
  if (!record(input)) {
    return null;
  }
  return parseLegendScrollDiagnosticRecord(input);
}

function parseLegendScrollDiagnosticRecord(
  input: Record<string, unknown>,
): ParsedLegendScrollDiagnostic | null {
  const parser = LEGEND_SCROLL_DIAGNOSTIC_PARSERS[String(input.phase)];
  if (parser === undefined) {
    return null;
  }
  return parser(input);
}

/** Validates and routes one dependency-owned observation to the timeline diagnostics owner. */
export function observeLegendScrollDiagnostic(
  diagnostics: TimelineScrollDiagnostics | undefined,
  input: unknown,
): void {
  const diagnostic = parseLegendScrollDiagnostic(input);
  if (diagnostic === null) {
    return;
  }
  observeParsedLegendScrollDiagnostic(diagnostics, diagnostic);
}

function observeParsedLegendScrollDiagnostic(
  diagnostics: TimelineScrollDiagnostics | undefined,
  diagnostic: ParsedLegendScrollDiagnostic,
): void {
  if (diagnostic.phase === "adjustment") {
    diagnostics?.libraryAdjustment(diagnostic);
    return;
  }
  observeLegendWorkOrCommand(diagnostics, diagnostic);
}

function observeLegendWorkOrCommand(
  diagnostics: TimelineScrollDiagnostics | undefined,
  diagnostic: TimelineLibraryPerformance | TimelineLibraryScrollCommand,
): void {
  if ("offsetPx" in diagnostic) {
    diagnostics?.libraryCommand(diagnostic);
    return;
  }
  diagnostics?.libraryPerformance(diagnostic);
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

function parseCalculation(value: Record<string, unknown>): TimelineLibraryPerformance | null {
  if (!hasCalculationFlags(value) || !hasCalculationNumbers(value)) {
    return null;
  }
  return {
    dataChanged: value.dataChanged,
    doMVCP: value.doMVCP,
    durationMs: value.durationMs,
    forceFullItemPositions: value.forceFullItemPositions,
    phase: "calculate",
    positionDurationMs: value.positionDurationMs,
    positionStartIndex: value.positionStartIndex,
    rowCount: value.rowCount,
    visibleEndIndex: value.visibleEndIndex,
    visibleStartIndex: value.visibleStartIndex,
  };
}

function parseSizeBatch(value: Record<string, unknown>): TimelineLibraryPerformance | null {
  if (
    !safeIntegerAtLeast(value.changedCount, 0) ||
    !nonNegativeFinite(value.durationMs) ||
    !safeIntegerAtLeast(value.measurementCount, 0) ||
    typeof value.needsRecalculate !== "boolean" ||
    !safeIntegerAtLeast(value.rowCount, 0)
  ) {
    return null;
  }
  return {
    changedCount: value.changedCount,
    durationMs: value.durationMs,
    measurementCount: value.measurementCount,
    needsRecalculate: value.needsRecalculate,
    phase: "size-batch",
    rowCount: value.rowCount,
  };
}

function nonNegativeFinite(value: unknown): value is number {
  return finite(value) && value >= 0;
}

function safeIntegerAtLeast(value: unknown, minimum: number): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= minimum;
}

const LEGEND_SCROLL_DIAGNOSTIC_PARSERS: Readonly<
  Record<string, LegendScrollDiagnosticParser | undefined>
> = {
  adjustment: parseAdjustment,
  calculate: parseCalculation,
  dispatch: parseCommand,
  retry: parseCommand,
  "size-batch": parseSizeBatch,
};
