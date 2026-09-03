import { colors } from "../../theme";
import type { TimelineDisplayTurn } from "./timelineTypes";

export function timelineClockLabel(value: string | null): string | null {
  if (value === null) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function timelineDurationLabel(durationMs: number | null): string | null {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) return null;
  if (durationMs < 1000) return `${durationMs} ms`;
  if (durationMs >= 60_000) {
    const minutes = Math.floor(durationMs / 60_000);
    const seconds = Math.round((durationMs % 60_000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
  return `${(durationMs / 1000).toFixed(1)} s`;
}

export function timelineCompactNumber(value: number): string {
  if (Math.abs(value) < 1000) return value.toLocaleString();
  if (Math.abs(value) < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}m`;
}

export function timelineStatusDotStyle(state: TimelineDisplayTurn["state"]): {
  backgroundColor: string;
} {
  if (state === "failed") return { backgroundColor: colors.red };
  if (state === "completed") return { backgroundColor: colors.green };
  return { backgroundColor: colors.textDim };
}

export function timelineTurnStateLabel(state: TimelineDisplayTurn["state"]): string {
  if (state === "running" || state === "queued") return "Running";
  if (state === "completed") return "Completed";
  if (state === "failed") return "Failed";
  return "Stopped";
}
