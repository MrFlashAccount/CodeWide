export type UserPreferenceRow = {
  id: string;
  updatedAt: number;
  value: string;
};

export type DocumentLayoutMode = "reading" | "wide";

export type DocumentViewerPreferences = {
  layoutMode: DocumentLayoutMode;
  textScale: number;
};

export const DOCUMENT_VIEWER_PREFERENCE_ID = "document-viewer";
const MIN_DOCUMENT_TEXT_SCALE = 0.8;
const MAX_DOCUMENT_TEXT_SCALE = 1.4;
export const DEFAULT_DOCUMENT_VIEWER_PREFERENCES: DocumentViewerPreferences = {
  layoutMode: "wide",
  textScale: 1,
};

// React Native has no CSS `ch` unit. 640 dp at the default type scale gives
// roughly a 70-80 character measure for our Roboto Flex body text. Scaling the
// column with the font keeps that readable measure stable when text size moves.
const DOCUMENT_READING_WIDTH_AT_100_PERCENT = 640;

export function decodeDocumentViewerPreferences(
  value: string | null | undefined,
): DocumentViewerPreferences {
  if (value === null || value === undefined) {
    return DEFAULT_DOCUMENT_VIEWER_PREFERENCES;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    const candidate = unknownRecord(parsed);
    if (candidate === null) {
      return DEFAULT_DOCUMENT_VIEWER_PREFERENCES;
    }
    return {
      layoutMode:
        candidate.layoutMode === "reading" || candidate.layoutMode === "wide"
          ? candidate.layoutMode
          : DEFAULT_DOCUMENT_VIEWER_PREFERENCES.layoutMode,
      textScale: normalizeDocumentTextScale(candidate.textScale),
    };
  } catch {
    return DEFAULT_DOCUMENT_VIEWER_PREFERENCES;
  }
}

export function encodeDocumentViewerPreferences(preferences: DocumentViewerPreferences): string {
  return JSON.stringify({
    layoutMode: preferences.layoutMode,
    textScale: normalizeDocumentTextScale(preferences.textScale),
  });
}

export function normalizeDocumentTextScale(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_DOCUMENT_VIEWER_PREFERENCES.textScale;
  }
  return Math.min(
    MAX_DOCUMENT_TEXT_SCALE,
    Math.max(MIN_DOCUMENT_TEXT_SCALE, Number(value.toFixed(1))),
  );
}

export function documentReadingWidth(textScale: number): number {
  return Math.round(DOCUMENT_READING_WIDTH_AT_100_PERCENT * normalizeDocumentTextScale(textScale));
}
import { unknownRecord } from "./unknownRecord";
