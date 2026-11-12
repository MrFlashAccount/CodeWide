import { observablePrimitive } from "@legendapp/state";

import {
  decodePeleDiagramRendererPreference,
  DEFAULT_PELE_DIAGRAM_RENDERER_PREFERENCE,
  encodePeleDiagramRendererPreference,
  PELE_DIAGRAM_RENDERER_PREFERENCE_ID,
} from "./peleDiagramRendererPreferences";
import { getUserPreferencesDatabase } from "./user-preferences-database";

export const peleDiagramRendererEnabled$ = observablePrimitive(
  DEFAULT_PELE_DIAGRAM_RENDERER_PREFERENCE.enabled,
);

const database = getUserPreferencesDatabase();

/** Hydrates the renderer choice before the workspace startup barrier completes. */
export async function hydratePeleDiagramRendererPreference(): Promise<boolean> {
  try {
    await database.ready;
    const preference = decodePeleDiagramRendererPreference(
      database.collection.get(PELE_DIAGRAM_RENDERER_PREFERENCE_ID)?.value,
    );
    peleDiagramRendererEnabled$.set(preference.enabled);
    return preference.enabled;
  } catch {
    peleDiagramRendererEnabled$.set(DEFAULT_PELE_DIAGRAM_RENDERER_PREFERENCE.enabled);
    return DEFAULT_PELE_DIAGRAM_RENDERER_PREFERENCE.enabled;
  }
}

/** Persists and live-applies the native diagram renderer choice. */
export async function writePeleDiagramRendererPreference(enabled: boolean): Promise<void> {
  await database.update(PELE_DIAGRAM_RENDERER_PREFERENCE_ID, () =>
    encodePeleDiagramRendererPreference({ enabled }),
  );
  peleDiagramRendererEnabled$.set(enabled);
}
