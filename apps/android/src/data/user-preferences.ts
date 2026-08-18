export type UserPreferenceRow = {
  id: string;
  value: string;
  updatedAt: number;
};

export type DocumentLayoutMode = "reading" | "wide";

export type DocumentViewerPreferences = {
  textScale: number;
  layoutMode: DocumentLayoutMode;
};

export const DOCUMENT_VIEWER_PREFERENCE_ID = "document-viewer";
export const MIN_DOCUMENT_TEXT_SCALE = 0.8;
export const MAX_DOCUMENT_TEXT_SCALE = 1.4;
export const DEFAULT_DOCUMENT_VIEWER_PREFERENCES: DocumentViewerPreferences = {
  textScale: 1,
  layoutMode: "wide",
};

// React Native has no CSS `ch` unit. 640 dp at the default type scale gives
// roughly a 70-80 character measure for our Roboto Flex body text. Scaling the
// column with the font keeps that readable measure stable when text size moves.
export const DOCUMENT_READING_WIDTH_AT_100_PERCENT = 640;

export function decodeDocumentViewerPreferences(value: string | null | undefined): DocumentViewerPreferences {
  if (value === null || value === undefined) return DEFAULT_DOCUMENT_VIEWER_PREFERENCES;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return DEFAULT_DOCUMENT_VIEWER_PREFERENCES;
    }
    const candidate = parsed as Record<string, unknown>;
    return {
      textScale: normalizeDocumentTextScale(candidate.textScale),
      layoutMode: candidate.layoutMode === "reading" || candidate.layoutMode === "wide"
        ? candidate.layoutMode
        : DEFAULT_DOCUMENT_VIEWER_PREFERENCES.layoutMode,
    };
  } catch {
    return DEFAULT_DOCUMENT_VIEWER_PREFERENCES;
  }
}

export function encodeDocumentViewerPreferences(preferences: DocumentViewerPreferences): string {
  return JSON.stringify({
    textScale: normalizeDocumentTextScale(preferences.textScale),
    layoutMode: preferences.layoutMode,
  });
}

export function normalizeDocumentTextScale(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_DOCUMENT_VIEWER_PREFERENCES.textScale;
  return Math.min(MAX_DOCUMENT_TEXT_SCALE, Math.max(MIN_DOCUMENT_TEXT_SCALE, Number(value.toFixed(1))));
}

export function documentReadingWidth(textScale: number): number {
  return Math.round(DOCUMENT_READING_WIDTH_AT_100_PERCENT * normalizeDocumentTextScale(textScale));
}
