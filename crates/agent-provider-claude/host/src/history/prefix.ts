/**
 * The bounded history prefix offered to a replacement session after Claude
 * lost the thread's session. Pure.
 */

/** Bound on the historical prefix used after a lost session. */
const BYTES_PER_KIB = 1024;
const HISTORY_PREFIX_MAX_KIB = 16;
export const HISTORY_PREFIX_MAX_BYTES = HISTORY_PREFIX_MAX_KIB * BYTES_PER_KIB;
export const HISTORY_HEADER = "[Historical conversation from this thread]";

/**
 * Keeps the most recent `HISTORY_PREFIX_MAX_BYTES` of the transcript lines
 * (whole lines only) under the history header.
 */
export function historyPrefix(lines: readonly string[]): string | null {
  const kept: string[] = [];
  let bytes = Buffer.byteLength(`${HISTORY_HEADER}\n\n`, "utf8");
  for (const line of lines.toReversed()) {
    const size = Buffer.byteLength(`${line}\n`, "utf8");
    if (bytes + size > HISTORY_PREFIX_MAX_BYTES) {
      break;
    }
    kept.unshift(line);
    bytes += size;
  }
  if (kept.length === 0) {
    return null;
  }
  return `${HISTORY_HEADER}\n${kept.join("\n")}\n\n`;
}
