export type DraftSelection = { start: number; end: number };

export function insertTranscriptAtSelection(
  source: string,
  selection: DraftSelection,
  rawTranscript: string,
): { text: string; cursor: number } {
  const start = clamp(Math.min(selection.start, selection.end), 0, source.length);
  const end = clamp(Math.max(selection.start, selection.end), start, source.length);
  const before = source.slice(0, start);
  const after = source.slice(end);
  const transcript = rawTranscript.trim();
  if (transcript === "") return { text: `${before}${after}`, cursor: before.length };
  const leading = /[\p{L}\p{N}]$/u.test(before) && /^[\p{L}\p{N}]/u.test(transcript) ? " " : "";
  const trailing = /[\p{L}\p{N}]$/u.test(transcript) && /^[\p{L}\p{N}]/u.test(after) ? " " : "";
  const inserted = `${leading}${transcript}`;
  return {
    text: `${before}${inserted}${trailing}${after}`,
    cursor: before.length + inserted.length,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}
