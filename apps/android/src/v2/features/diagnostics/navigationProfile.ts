import type { NavigationProfile } from "./diagnosticsTypes";

interface SpeedscopeFrame {
  file?: string;
  name: string;
}

interface SpeedscopeEvent {
  at: number;
  frame: number;
  type: "C" | "O";
}

export function navigationHudSummary(profile: NavigationProfile | null): string {
  if (profile === null) return "chat profile waiting";
  const prefix =
    profile.status === "active" ? "chat profiling" : `chat ${integer(profile.totalMs)} ms`;
  const stage =
    profile.bottleneckStage === null
      ? readableName(profile.currentStage)
      : `${readableName(profile.bottleneckStage)} ${integer(profile.bottleneckMs)} ms`;
  const rows = `${String(profile.uniqueRowsCommitted)} rows/${String(profile.rowCommits)} commits`;
  const slowest = profile.measures.reduce<(typeof profile.measures)[number] | null>(
    (current, measure) =>
      current === null || measure.durationMs > current.durationMs ? measure : current,
    null,
  );
  const hotPath =
    slowest === null ? "" : ` · hot ${slowest.name} ${integer(slowest.durationMs)} ms`;
  const frames =
    profile.frames === null
      ? ""
      : ` · ${String(profile.frames.jankFrames)} jank/${String(profile.frames.droppedFrameEstimate)} missed`;
  return `${prefix} · ${stage} · ${rows}${hotPath}${frames}`;
}

/** Produces the self-contained profile consumed by the bundled local viewer. */
export function serializeNavigationSpeedscopeProfile(profile: NavigationProfile): string {
  const frames: SpeedscopeFrame[] = [];
  const stageEvents: SpeedscopeEvent[] = [];
  let previousStageEnd = 0;
  for (const record of profile.stages) {
    const end = finiteNonNegative(record.elapsedMs);
    const start = Math.min(end, previousStageEnd);
    const frame =
      frames.push(
        speedscopeFrame(
          `${readableName(record.stage)} · ${formatDuration(record.sincePreviousMs)}`,
          formatDetails(record.values, record.tags),
        ),
      ) - 1;
    stageEvents.push({ at: start, frame, type: "O" }, { at: end, frame, type: "C" });
    previousStageEnd = Math.max(previousStageEnd, end);
  }
  const measureSamples: number[][] = [];
  const measureWeights: number[] = [];
  for (const measure of profile.measures) {
    const duration = finiteNonNegative(measure.durationMs);
    if (duration === 0) continue;
    const frame =
      frames.push(speedscopeFrame(measure.name, formatDetails(measure.values, measure.tags))) - 1;
    measureSamples.push([frame]);
    measureWeights.push(duration);
  }
  const visualEvents: SpeedscopeEvent[] = [];
  let previousVisualEnd = 0;
  const orderedVisualEvents = profile.visualEvents
    .map((event, index) => ({ event, index }))
    .toSorted((left, right) => {
      const elapsedDifference =
        finiteNonNegative(left.event.elapsedMs) - finiteNonNegative(right.event.elapsedMs);
      return elapsedDifference === 0 ? left.index - right.index : elapsedDifference;
    });
  for (const entry of orderedVisualEvents) {
    const start = Math.max(previousVisualEnd, finiteNonNegative(entry.event.elapsedMs));
    const end = start + 0.01;
    const frame =
      frames.push(
        speedscopeFrame(entry.event.name, formatDetails(entry.event.values, entry.event.tags)),
      ) - 1;
    visualEvents.push({ at: start, frame, type: "O" }, { at: end, frame, type: "C" });
    previousVisualEnd = end;
  }
  const endValue = Math.max(
    1,
    finiteNonNegative(profile.totalMs),
    previousStageEnd,
    previousVisualEnd,
  );
  const profiles: unknown[] = [];
  if (stageEvents.length > 0) {
    profiles.push({
      endValue,
      events: stageEvents,
      name: "Navigation stages",
      startValue: 0,
      type: "evented",
      unit: "milliseconds",
    });
  }
  if (measureSamples.length > 0) {
    profiles.push({
      endValue: measureWeights.reduce((total, duration) => total + duration, 0),
      name: "Measured work",
      samples: measureSamples,
      startValue: 0,
      type: "sampled",
      unit: "milliseconds",
      weights: measureWeights,
    });
  }
  if (visualEvents.length > 0) {
    profiles.push({
      endValue,
      events: visualEvents,
      name: "Visible UI states",
      startValue: 0,
      type: "evented",
      unit: "milliseconds",
    });
  }
  return JSON.stringify({
    $schema: "https://www.speedscope.app/file-format-schema.json",
    activeProfileIndex: 0,
    exporter: "CodeWide V2",
    name: `Navigation ${profile.threadId}`,
    profiles,
    shared: { frames },
  });
}

function formatDetails(
  values: Readonly<Record<string, number>>,
  tags: Readonly<Record<string, string>>,
): string | undefined {
  const fields = [
    ...Object.entries(values).map(formatNumberEntry),
    ...Object.entries(tags).map(formatStringEntry),
  ];
  return fields.length === 0 ? undefined : fields.join(" · ");
}

function formatNumberEntry(entry: [string, number]): string {
  const [key, value] = entry;
  return `${key}=${finiteNumber(value)}`;
}

function formatStringEntry(entry: [string, string]): string {
  const [key, value] = entry;
  return `${key}=${value}`;
}

function formatDuration(value: number): string {
  const duration = finiteNonNegative(value);
  return duration >= 100 ? `${String(Math.round(duration))} ms` : `${duration.toFixed(1)} ms`;
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function finiteNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : "n/a";
}

function integer(value: number): string {
  return String(Math.round(value));
}

function readableName(value: string): string {
  return value.replaceAll("_", " ");
}

function speedscopeFrame(name: string, file: string | undefined): SpeedscopeFrame {
  return file === undefined ? { name } : { file, name };
}
