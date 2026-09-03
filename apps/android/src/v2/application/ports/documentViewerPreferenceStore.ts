export type DocumentLayoutMode = "reading" | "wide";

export interface DocumentViewerPreferences {
  layoutMode: DocumentLayoutMode;
  textScale: number;
}

/** Persists device-local reader presentation independently from server projections. */
export interface DocumentViewerPreferenceStore {
  load(): Promise<DocumentViewerPreferences | null>;
  save(preferences: DocumentViewerPreferences): Promise<void>;
}
