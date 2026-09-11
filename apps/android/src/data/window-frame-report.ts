const fields = [
  "windowStartUnixMs", "windowEndUnixMs", "frameCount", "jankFrameCount",
  "missedVsyncEstimate", "droppedMetricReports", "jankFrameTotalMs", "overrunTotalMs",
  "maxFrameMs", "maxOverrunMs", "maxLayoutMs", "maxDrawMs", "maxGpuMs", "maxUiDelayMs",
] as const;

type Surface = "app" | "sheet" | "projects" | "folders" | "ports" | "skills" | "settings";

export interface WindowFrameSample {
  surface: Surface;
  activity: "scroll" | "other";
  appBuild: number | null;
  values: Record<string, number>;
}

export interface WindowFrameReport {
  version: 1;
  evictedWindows: number;
  unobservedWindows: number;
  windows: WindowFrameSample[];
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Validate the native boundary and discard all text, coordinates, paths and unknown attributes. */
export function parseWindowFrameSample(input: unknown): WindowFrameSample | null {
  if (!record(input)) return null;
  const surface = input.surface ?? "app";
  if (surface !== "app" && surface !== "sheet" && surface !== "projects" && surface !== "folders" && surface !== "ports" && surface !== "skills" && surface !== "settings") return null;
  const activity = input.activity ?? "other";
  if (activity !== "scroll" && activity !== "other") return null;
  const appBuild = input.appBuild ?? null;
  if (appBuild !== null && (typeof appBuild !== "number" || !Number.isSafeInteger(appBuild) || appBuild < 0)) return null;
  const values: Record<string, number> = {};
  for (const field of fields) {
    const value = input[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
    values[field] = value;
  }
  if (Number(input.windowEndUnixMs) < Number(input.windowStartUnixMs) || Number(input.jankFrameCount) > Number(input.frameCount)) return null;
  return { surface, activity, appBuild, values };
}

/** Bounded, content-free report suitable for explicit export even without a server connection. */
export function parseWindowFrameReport(json: unknown): WindowFrameReport | null {
  if (typeof json !== "string" || json.length > 1_048_576) return null;
  let input: unknown;
  try { input = JSON.parse(json); } catch { return null; }
  if (!record(input) || input.version !== 1 || !Array.isArray(input.windows)) return null;
  if (typeof input.evictedWindows !== "number" || !Number.isSafeInteger(input.evictedWindows) || input.evictedWindows < 0) return null;
  if (typeof input.unobservedWindows !== "number" || !Number.isSafeInteger(input.unobservedWindows) || input.unobservedWindows < 0) return null;
  const windows: WindowFrameSample[] = [];
  for (let index = 0; index < Math.min(input.windows.length, 600); index += 1) {
    const sample = parseWindowFrameSample(input.windows[index]);
    if (sample !== null) windows.push(sample);
  }
  return { version: 1, evictedWindows: input.evictedWindows, unobservedWindows: input.unobservedWindows, windows };
}
