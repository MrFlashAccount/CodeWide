import type { ThreadNavigationProfile } from "./thread-navigation-metrics";

type SpeedscopeFrame = { name: string; file?: string };
type SpeedscopeEvent = { type: "O" | "C"; at: number; frame: number };

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
    const frame = frames.push(speedscopeFrame(
      `${readableName(record.stage)} · ${formatDuration(record.sincePreviousMs)}`,
      formatDetails(record.values, record.tags),
    )) - 1;
    stageEvents.push(
      { type: "O", at: start, frame },
      { type: "C", at: end, frame },
    );
    previousStageEnd = Math.max(previousStageEnd, end);
  }

  const measureSamples: number[][] = [];
  const measureWeights: number[] = [];
  for (const measure of profile.measures) {
    const duration = finiteNonNegative(measure.durationMs);
    if (duration === 0) continue;
    const frame = frames.push(speedscopeFrame(
      measure.name,
      formatDetails(
        { durationMs: duration, completedAtMs: finiteNonNegative(measure.elapsedMs), ...measure.values },
        measure.tags,
      ),
    )) - 1;
    measureSamples.push([frame]);
    measureWeights.push(duration);
  }

  const endValue = Math.max(1, finiteNonNegative(profile.totalMs), previousStageEnd);
  const profiles: unknown[] = [];
  if (stageEvents.length > 0) {
    profiles.push({
      type: "evented",
      name: "Navigation stages",
      unit: "milliseconds",
      startValue: 0,
      endValue,
      events: stageEvents,
    });
  }
  if (measureSamples.length > 0) {
    profiles.push({
      type: "sampled",
      name: "Measured work",
      unit: "milliseconds",
      startValue: 0,
      endValue: measureWeights.reduce((total, duration) => total + duration, 0),
      samples: measureSamples,
      weights: measureWeights,
    });
  }

  return JSON.stringify({
    $schema: "https://www.speedscope.app/file-format-schema.json",
    exporter: "CodeWide",
    name: `Navigation ${profile.threadId}`,
    activeProfileIndex: 0,
    shared: { frames },
    profiles,
  });
}

function readableName(value: string): string {
  return value.replaceAll("_", " ");
}

function speedscopeFrame(name: string, file: string | undefined): SpeedscopeFrame {
  return file === undefined ? { name } : { name, file };
}

function formatDuration(value: number): string {
  const duration = finiteNonNegative(value);
  return duration >= 100 ? `${Math.round(duration)} ms` : `${duration.toFixed(1)} ms`;
}

function formatDetails(values: Readonly<Record<string, number>>, tags: Readonly<Record<string, string>>): string | undefined {
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
