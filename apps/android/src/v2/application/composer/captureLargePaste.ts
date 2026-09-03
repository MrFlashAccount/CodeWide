import type { LargePasteCapture } from "./composerAttachmentTypes";

export const AUTO_ATTACH_PASTE_MIN_CHARS = 10_000;

interface ReplacedRange {
  end: number;
  start: number;
}

/** Captures the untouched clipboard payload before Android truncates the TextInput value. */
export function captureLargePaste(
  previousText: string,
  pastedText: string,
  replacedRange: ReplacedRange | null,
  minimumChars = AUTO_ATTACH_PASTE_MIN_CHARS,
): LargePasteCapture | null {
  if (pastedText.length <= minimumChars) return null;
  const requestedStart = replacedRange?.start ?? previousText.length;
  const start = Math.max(0, Math.min(requestedStart, previousText.length));
  const requestedEnd = replacedRange?.end ?? start;
  const end = Math.max(start, Math.min(requestedEnd, previousText.length));
  const prefix = previousText.slice(0, start);
  const suffix = previousText.slice(end);
  return {
    attachmentText: pastedText,
    draftText: `${prefix}${suffix}`,
    insertionOffset: start,
    pastedDraftText: `${prefix}${pastedText}${suffix}`,
  };
}
