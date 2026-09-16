import { useLiveQuery } from "@tanstack/react-db";

import { appLogger } from "../observability/logger";
import { getUserPreferencesDatabase } from "../data/user-preferences-database";
import { useEvent } from "../react/useEvent";
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

function updateDocumentViewerPreferences(
  apply: (current: DocumentViewerPreferences) => DocumentViewerPreferences,
): void {
  void database
    .update(DOCUMENT_VIEWER_PREFERENCE_ID, (current) =>
      encodeDocumentViewerPreferences(apply(decodeDocumentViewerPreferences(current))),
    )
    .catch((error: unknown) => {
      appLogger.warnCaught({ error, event: "document_viewer.preferences_save.failed" });
    });
}

export function useDocumentViewerPreferences(): {
  changeTextScale: (delta: number) => void;
  preferences: DocumentViewerPreferences;
  resetTextScale: () => void;
  setLayoutMode: (mode: DocumentLayoutMode) => void;
} {
  const query = useLiveQuery(() => database.collection);
  const row = query.data?.find((candidate) => candidate.id === DOCUMENT_VIEWER_PREFERENCE_ID);
  const preferences =
    row === undefined
      ? DEFAULT_DOCUMENT_VIEWER_PREFERENCES
      : decodeDocumentViewerPreferences(row.value);
  const changeTextScale = useEvent((delta: number) => {
    updateDocumentViewerPreferences((current) => ({
      ...current,
      textScale: normalizeDocumentTextScale(current.textScale + delta),
    }));
  });
  const resetTextScale = useEvent(() => {
    updateDocumentViewerPreferences((current) => ({
      ...current,
      textScale: DEFAULT_DOCUMENT_VIEWER_PREFERENCES.textScale,
    }));
  });
  const setLayoutMode = useEvent((layoutMode: DocumentLayoutMode) => {
    updateDocumentViewerPreferences((current) => ({ ...current, layoutMode }));
  });
  return {
    changeTextScale,
    preferences,
    resetTextScale,
    setLayoutMode,
  };
}
