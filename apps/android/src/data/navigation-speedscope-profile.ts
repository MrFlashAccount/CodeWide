import type { ThreadNavigationProfile } from "./thread-navigation-metrics";

type SpeedscopeFrame = { file?: string; name: string };
type SpeedscopeEvent = { at: number; frame: number; type: "O" | "C" };

/**
 * Projects CodeWide navigation telemetry into Speedscope's documented file
 * format. Speedscope owns parsing, layout, zooming, search, and rendering.
 */
export function serializeNavigationSpeedscopeProfile(profile: ThreadNavigationProfile): string {
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
    if (duration === 0) {
      continue;
    }
    const frame =
      frames.push(
        speedscopeFrame(
          measure.name,
          formatDetails(
            {
              completedAtMs: finiteNonNegative(measure.elapsedMs),
              durationMs: duration,
              ...measure.values,
            },
            measure.tags,
          ),
        ),
      ) - 1;
    measureSamples.push([frame]);
    measureWeights.push(duration);
  }

  const visualEvents: SpeedscopeEvent[] = [];
  let previousVisualEnd = 0;
  // Speedscope evented profiles are a stack machine: events must be ordered and
  // may only overlap when properly nested. Multiple layout probes often commit
  // within the same sub-millisecond interval, so fixed-width markers can cross
  // each other (open A, open B, close A) and make the whole profile invalid.
  // Serialize them as tiny, stable, non-overlapping markers instead.
  const orderedVisualEvents = profile.visualEvents
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
      const elapsedOrder =
        finiteNonNegative(left.event.elapsedMs) - finiteNonNegative(right.event.elapsedMs);
      return elapsedOrder !== 0 ? elapsedOrder : left.index - right.index;
    });
  for (const { event } of orderedVisualEvents) {
    const start = Math.max(previousVisualEnd, finiteNonNegative(event.elapsedMs));
    const end = start + 0.01;
    const frame =
      frames.push(speedscopeFrame(event.name, formatDetails(event.values, event.tags))) - 1;
    visualEvents.push({ at: start, frame, type: "O" }, { at: end, frame, type: "C" });
    previousVisualEnd = end;
  }

  const lastVisualEventAt = previousVisualEnd;
  const endValue = Math.max(
    1,
    finiteNonNegative(profile.totalMs),
    previousStageEnd,
    lastVisualEventAt,
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
    exporter: "CodeWide",
    name: `Navigation ${profile.threadId}`,
    profiles,
    shared: { frames },
  });
}

function readableName(value: string): string {
  return value.replaceAll("_", " ");
}

function speedscopeFrame(name: string, file: string | undefined): SpeedscopeFrame {
  return file === undefined ? { name } : { file, name };
}

function formatDuration(value: number): string {
  const duration = finiteNonNegative(value);
  return duration >= 100 ? `${String(Math.round(duration))} ms` : `${duration.toFixed(1)} ms`;
}

function formatDetails(
  values: Readonly<Record<string, number>>,
  tags: Readonly<Record<string, string>>,
): string | undefined {
  const fields = [
    ...Object.entries(values).map(([key, value]) => `${key}=${finiteNumber(value)}`),
    ...Object.entries(tags).map(([key, value]) => `${key}=${value}`),
  ];
  return fields.length === 0 ? undefined : fields.join(" · ");
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function finiteNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : "n/a";
}
