export interface VoiceTranscriptSelection {
  end: number;
  start: number;
}

export interface VoiceTranscriptInsertion {
  cursor: number;
  text: string;
}

/** Inserts an authoritative transcript at the latest known input selection. */
export function insertVoiceTranscript(
  source: string,
  selection: VoiceTranscriptSelection,
  rawTranscript: string,
): VoiceTranscriptInsertion {
  const start = clamp(Math.min(selection.start, selection.end), 0, source.length);
  const end = clamp(Math.max(selection.start, selection.end), start, source.length);
  const before = source.slice(0, start);
  const after = source.slice(end);
  const transcript = rawTranscript.trim();
  if (transcript === "") return { cursor: before.length, text: `${before}${after}` };
  const leading = /[\p{L}\p{N}]$/u.test(before) && /^[\p{L}\p{N}]/u.test(transcript) ? " " : "";
  const trailing = /[\p{L}\p{N}]$/u.test(transcript) && /^[\p{L}\p{N}]/u.test(after) ? " " : "";
  const inserted = `${leading}${transcript}`;
  return {
    cursor: before.length + inserted.length,
    text: `${before}${inserted}${trailing}${after}`,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}
