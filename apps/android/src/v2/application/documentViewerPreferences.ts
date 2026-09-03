import type {
  DocumentLayoutMode,
  DocumentViewerPreferences,
} from "./ports/documentViewerPreferenceStore";

export const MIN_DOCUMENT_TEXT_SCALE = 0.8;
export const MAX_DOCUMENT_TEXT_SCALE = 1.4;
export const DEFAULT_DOCUMENT_VIEWER_PREFERENCES: DocumentViewerPreferences = {
  layoutMode: "wide",
  textScale: 1,
};
const READING_WIDTH = 640;

function normalizeDocumentTextScale(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.min(
    MAX_DOCUMENT_TEXT_SCALE,
    Math.max(MIN_DOCUMENT_TEXT_SCALE, Number(value.toFixed(1))),
  );
}

export function documentReadingWidth(textScale: number): number {
  return Math.round(READING_WIDTH * normalizeDocumentTextScale(textScale));
}

export function documentViewerPreferences(
  layoutMode: DocumentLayoutMode,
  textScale: unknown,
): DocumentViewerPreferences {
  return { layoutMode, textScale: normalizeDocumentTextScale(textScale) };
}
