import { useLiveQuery } from "@tanstack/react-db";

import { getUserPreferencesDatabase } from "../data/user-preferences-database";
import {
  DEFAULT_DOCUMENT_VIEWER_PREFERENCES,
  DOCUMENT_VIEWER_PREFERENCE_ID,
  decodeDocumentViewerPreferences,
  encodeDocumentViewerPreferences,
  normalizeDocumentTextScale,
  type DocumentLayoutMode,
  type DocumentViewerPreferences,
} from "../data/user-preferences";

const database = getUserPreferencesDatabase();

export function useDocumentViewerPreferences(): {
  preferences: DocumentViewerPreferences;
  changeTextScale(delta: number): void;
  resetTextScale(): void;
  setLayoutMode(mode: DocumentLayoutMode): void;
} {
  const query = useLiveQuery(() => database.collection);
  const row = query.data?.find((candidate) => candidate.id === DOCUMENT_VIEWER_PREFERENCE_ID);
  const preferences = row === undefined
    ? DEFAULT_DOCUMENT_VIEWER_PREFERENCES
    : decodeDocumentViewerPreferences(row.value);
  const update = (apply: (current: DocumentViewerPreferences) => DocumentViewerPreferences) => {
    void database.update(DOCUMENT_VIEWER_PREFERENCE_ID, (current) => (
      encodeDocumentViewerPreferences(apply(decodeDocumentViewerPreferences(current)))
    )).catch((cause: unknown) => {
      console.warn("Could not save document viewer preferences", cause);
    });
  };
  return {
    preferences,
    changeTextScale(delta) {
      update((current) => ({
        ...current,
        textScale: normalizeDocumentTextScale(current.textScale + delta),
      }));
    },
    resetTextScale() {
      update((current) => ({ ...current, textScale: DEFAULT_DOCUMENT_VIEWER_PREFERENCES.textScale }));
    },
    setLayoutMode(layoutMode) {
      update((current) => ({ ...current, layoutMode }));
    },
  };
}
