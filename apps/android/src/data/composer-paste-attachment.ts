export const AUTO_ATTACH_PASTE_MIN_CHARS = 10_000;

export type ClipboardLargePasteCapture = {
  attachmentText: string;
  draftText: string;
  insertionOffset: number;
  pastedDraftText: string;
};

/** Builds a capture from the untouched native clipboard payload. */
export function captureClipboardLargePaste(
  previousText: string,
  pastedText: string,
  replacedRange: { start: number; end: number } | null,
  minimumChars = AUTO_ATTACH_PASTE_MIN_CHARS,
): ClipboardLargePasteCapture | null {
  if (pastedText.length <= minimumChars) return null;
  const start = Math.max(0, Math.min(replacedRange?.start ?? previousText.length, previousText.length));
  const end = Math.max(start, Math.min(replacedRange?.end ?? start, previousText.length));
  const prefix = previousText.slice(0, start);
  const suffix = previousText.slice(end);
  return {
    attachmentText: pastedText,
    draftText: `${prefix}${suffix}`,
    insertionOffset: start,
    pastedDraftText: `${prefix}${pastedText}${suffix}`,
  };
}
