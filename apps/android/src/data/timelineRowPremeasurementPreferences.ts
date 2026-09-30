import { unknownRecord } from "./unknownRecord";

export const TIMELINE_ROW_PREMEASUREMENT_PREFERENCE_ID = "timeline-row-premeasurement";

/** Device-wide opt-in for experimental exact timeline-row premeasurement. */
export type TimelineRowPremeasurementPreference = {
  readonly enabled: boolean;
};

export const DEFAULT_TIMELINE_ROW_PREMEASUREMENT_PREFERENCE: TimelineRowPremeasurementPreference = {
  enabled: false,
};

export function decodeTimelineRowPremeasurementPreference(
  value: string | null | undefined,
): TimelineRowPremeasurementPreference {
  if (value === null || value === undefined) {
    return DEFAULT_TIMELINE_ROW_PREMEASUREMENT_PREFERENCE;
  }
  try {
    const parsed = unknownRecord(JSON.parse(value));
    if (parsed === null || parsed.schemaVersion !== 1 || typeof parsed.enabled !== "boolean") {
      return DEFAULT_TIMELINE_ROW_PREMEASUREMENT_PREFERENCE;
    }
    return { enabled: parsed.enabled };
  } catch {
    return DEFAULT_TIMELINE_ROW_PREMEASUREMENT_PREFERENCE;
  }
}

export function encodeTimelineRowPremeasurementPreference(
  preference: TimelineRowPremeasurementPreference,
): string {
  return JSON.stringify({ enabled: preference.enabled, schemaVersion: 1 });
}
