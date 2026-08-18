export const TARGET_MARKDOWN_SEGMENT_CHARS = 48 * 1024;
export const MAX_MARKDOWN_SEGMENT_CHARS = 96 * 1024;

export type MarkdownStreamProjection = {
  segments: string[];
  remainder: string;
};

export type MarkdownStreamLimits = {
  targetSegmentChars: number;
  maxSegmentChars: number;
};

const DEFAULT_LIMITS: MarkdownStreamLimits = {
  targetSegmentChars: TARGET_MARKDOWN_SEGMENT_CHARS,
  maxSegmentChars: MAX_MARKDOWN_SEGMENT_CHARS,
};

/**
 * Converts incrementally downloaded Markdown into bounded parser inputs while
 * preserving every source character and keeping fenced blocks valid.
 */
export function projectMarkdownStream(
  remainder: string,
  chunk: string,
  complete: boolean,
  limits: MarkdownStreamLimits = DEFAULT_LIMITS,
): MarkdownStreamProjection {
  let pending = `${remainder}${chunk}`;
  const segments: string[] = [];
  while (pending.length > 0) {
    const split = nextSegment(pending, complete, limits);
    if (split === null) break;
    if (split.segment.length > 0) segments.push(split.segment);
    if (split.remainder === pending) break;
    pending = split.remainder;
  }
  return { segments, remainder: pending };
}

export function projectCompleteMarkdown(source: string): string[] {
  if (source === "") return [];
  const projected = projectMarkdownStream("", source, true);
  return [...projected.segments, ...(projected.remainder === "" ? [] : [projected.remainder])];
}

type SegmentSplit = { segment: string; remainder: string };
type Fence = { marker: string; opener: string };

function nextSegment(source: string, complete: boolean, limits: MarkdownStreamLimits): SegmentSplit | null {
  let cursor = 0;
  let fence: Fence | null = null;
  let lastSafeBoundary = -1;
  while (cursor < source.length) {
    const newline = source.indexOf("\n", cursor);
    if (newline < 0) break;
    const lineEnd = newline + 1;
    const line = source.slice(cursor, newline);
    fence = updateFence(fence, line);
    if (fence === null && line.trim().length === 0) lastSafeBoundary = lineEnd;
    if (lastSafeBoundary >= limits.targetSegmentChars) return sliceAt(source, lastSafeBoundary);
    if (lineEnd >= limits.maxSegmentChars) {
      const boundary = safeStringBoundary(source, limits.maxSegmentChars);
      if (fence !== null) return splitFence(source, boundary, fence);
      return sliceAt(source, boundary);
    }
    cursor = lineEnd;
  }

  if (source.length >= limits.maxSegmentChars) {
    const boundary = safeStringBoundary(source, limits.maxSegmentChars);
    if (fence !== null) return splitFence(source, boundary, fence);
    return sliceAt(source, boundary);
  }
  if (complete) return sliceAt(source, source.length);
  return null;
}

function updateFence(current: Fence | null, line: string): Fence | null {
  const match = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (match === null) return current;
  const marker = match[1]!;
  if (current === null) return { marker, opener: `${marker}${match[2] ?? ""}` };
  return marker[0] === current.marker[0] && marker.length >= current.marker.length ? null : current;
}

function splitFence(source: string, boundary: number, fence: Fence): SegmentSplit {
  const prefix = source.slice(0, boundary);
  const suffix = source.slice(boundary);
  return {
    segment: `${prefix}${prefix.endsWith("\n") ? "" : "\n"}${fence.marker}\n`,
    remainder: `${fence.opener}\n${suffix}`,
  };
}

function sliceAt(source: string, boundary: number): SegmentSplit {
  return { segment: source.slice(0, boundary), remainder: source.slice(boundary) };
}

function safeStringBoundary(source: string, requested: number): number {
  const boundary = Math.min(source.length, requested);
  const previous = source.charCodeAt(boundary - 1);
  const next = source.charCodeAt(boundary);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
    ? boundary - 1
    : boundary;
}
