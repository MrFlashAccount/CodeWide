import { observablePrimitive } from "@legendapp/state";

import { getUserPreferencesDatabase } from "./user-preferences-database";
import {
  decodeTimelineRowPremeasurementPreference,
  DEFAULT_TIMELINE_ROW_PREMEASUREMENT_PREFERENCE,
  encodeTimelineRowPremeasurementPreference,
  TIMELINE_ROW_PREMEASUREMENT_PREFERENCE_ID,
} from "./timelineRowPremeasurementPreferences";

export const timelineRowPremeasurementEnabled$ = observablePrimitive(
  DEFAULT_TIMELINE_ROW_PREMEASUREMENT_PREFERENCE.enabled,
);

const database = getUserPreferencesDatabase();

/** Hydrates the process-wide strategy before the workspace startup barrier completes. */
export async function hydrateTimelineRowPremeasurementPreference(): Promise<boolean> {
  try {
    await database.ready;
    const preference = decodeTimelineRowPremeasurementPreference(
      database.collection.get(TIMELINE_ROW_PREMEASUREMENT_PREFERENCE_ID)?.value,
    );
    timelineRowPremeasurementEnabled$.set(preference.enabled);
    return preference.enabled;
  } catch {
    timelineRowPremeasurementEnabled$.set(DEFAULT_TIMELINE_ROW_PREMEASUREMENT_PREFERENCE.enabled);
    return DEFAULT_TIMELINE_ROW_PREMEASUREMENT_PREFERENCE.enabled;
  }
}

/** Persists and live-applies the experimental timeline measurement strategy. */
export async function writeTimelineRowPremeasurementPreference(enabled: boolean): Promise<void> {
  await database.update(TIMELINE_ROW_PREMEASUREMENT_PREFERENCE_ID, () =>
    encodeTimelineRowPremeasurementPreference({ enabled }),
  );
  timelineRowPremeasurementEnabled$.set(enabled);
}
