import { observablePrimitive } from "@legendapp/state";

import { getUserPreferencesDatabase } from "./user-preferences-database";
import { appLogger } from "../observability/logger";

import { maximumPanePercent, MIN_PANE_PERCENT, type PanePair } from "../ui/paneSplitSizes";

/** Leading pane percentages. An unset catalog uses the responsive sidebar default. */
export const paneSplitPreferences$ = {
  "center+right": observablePrimitive<number | null>(null),
  "left+center": observablePrimitive<number | null>(null),
};

const keys = { "center+right": "pane.split.detail", "left+center": "pane.split.catalog" } as const;

/** Restores the last open size per pair while the existing settings database hydrates. */
export async function hydratePaneSplitPreferences(): Promise<void> {
  const database = getUserPreferencesDatabase();
  try {
    await database.ready;
    for (const pair of ["left+center", "center+right"] as const) {
      const percent = Number(database.collection.get(keys[pair])?.value);
      if (
        percent >= MIN_PANE_PERCENT &&
        percent <= maximumPanePercent(pair) &&
        paneSplitPreferences$[pair].peek() === null
      ) {
        paneSplitPreferences$[pair].set(percent);
      }
    }
  } catch (error) {
    appLogger.warnCaught({ error, event: "pane.split.read_failed" });
  }
}

/** Publishes a settled size immediately and persists it in the device's serialized preference queue. */
export function rememberPaneSplit(pair: PanePair, percent: number): void {
  if (
    !Number.isFinite(percent) ||
    percent < MIN_PANE_PERCENT ||
    percent > maximumPanePercent(pair)
  ) {
    return;
  }
  paneSplitPreferences$[pair].set(percent);
  void getUserPreferencesDatabase()
    .update(keys[pair], () => String(percent))
    .catch((error: unknown) => {
      appLogger.warnCaught({ error, event: "pane.split.write_failed" });
    });
}
