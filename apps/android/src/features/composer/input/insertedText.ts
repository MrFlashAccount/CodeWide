/** Locates the single text range inserted between two editor snapshots. */
export function insertedText(
  previous: string,
  next: string,
): { end: number; start: number; text: string } | null {
  if (next === previous) {
    return null;
  }
  let start = 0;
  while (start < previous.length && previous[start] === next[start]) {
    start += 1;
  }
  let suffix = 0;
  while (
    suffix < previous.length - start &&
    previous[previous.length - suffix - 1] === next[next.length - suffix - 1]
  ) {
    suffix += 1;
  }
  return {
    end: previous.length - suffix,
    start,
    text: next.slice(start, next.length - suffix),
  };
}
