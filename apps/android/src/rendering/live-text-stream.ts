import { projectLiveMarkdownTail, projectMarkdownStream } from "@codewide/rendering-core";

export const LIVE_TEXT_TARGET_SEGMENT_CHARS = 8 * 1024;
export const LIVE_TEXT_MAX_PENDING_CHARS = 24 * 1024;
export const LIVE_TEXT_CACHE_MAX_ENTRIES = 12;
export const LIVE_TEXT_CACHE_MAX_SOURCE_CHARS = 1024 * 1024;

export type LiveTextProjection = {
  remainder: string;
  segments: readonly string[];
  source: string;
};

export type LiveMarkdownProjection = LiveTextProjection & {
  visibleRemainder: string;
  visibleSource: string;
};

const liveTextProjectionCache = new Map<string, LiveTextProjection>();
const liveMarkdownProjectionCache = new Map<
  string,
  { complete: boolean; source: string; value: LiveMarkdownProjection }
>();
let liveTextProjectionSourceChars = 0;

/**
 * Process-owned projection cache. Renderers are pure consumers: component
 * mount/recycling never owns or resets the append-only stream prefix.
 */
export function projectCachedLiveText(cacheKey: string, source: string): LiveTextProjection {
  const previous = liveTextProjectionCache.get(cacheKey) ?? null;
  const projection = projectLiveTextAppend(previous, source);
  if (previous !== null) {
    liveTextProjectionSourceChars -= previous.source.length;
  }
  liveTextProjectionCache.delete(cacheKey);
  liveTextProjectionCache.set(cacheKey, projection);
  liveTextProjectionSourceChars += projection.source.length;
  while (
    liveTextProjectionCache.size > LIVE_TEXT_CACHE_MAX_ENTRIES ||
    liveTextProjectionSourceChars > LIVE_TEXT_CACHE_MAX_SOURCE_CHARS
  ) {
    const oldest = liveTextProjectionCache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    const evicted = liveTextProjectionCache.get(oldest);
    if (evicted !== undefined) {
      liveTextProjectionSourceChars -= evicted.source.length;
    }
    liveTextProjectionCache.delete(oldest);
    liveMarkdownProjectionCache.delete(oldest);
  }
  return projection;
}

/**
 * One render-frame projection for live Markdown. Bubble measurement and the
 * Markdown renderer must consume this same visible source: the authoritative
 * native value can end in an incomplete Markdown construct that is withheld
 * from this frame. Plain text, including unfinished words, is never batched here.
 */
export function projectCachedLiveMarkdown(
  cacheKey: string,
  source: string,
  complete = false,
): LiveMarkdownProjection {
  const cached = liveMarkdownProjectionCache.get(cacheKey);
  if (cached?.source === source && cached.complete === complete) {
    return cached.value;
  }
  const projection = projectCachedLiveText(cacheKey, source);
  const visibleRemainder = projectLiveMarkdownTail(projection.remainder, complete).visible;
  const value = {
    ...projection,
    visibleRemainder,
    visibleSource: [...projection.segments, visibleRemainder].join(""),
  };
  liveMarkdownProjectionCache.set(cacheKey, { complete, source, value });
  return value;
}

export function liveTextProjectionCacheStats(): { entries: number; sourceChars: number } {
  return { entries: liveTextProjectionCache.size, sourceChars: liveTextProjectionSourceChars };
}

export function clearLiveTextProjectionCache(): void {
  liveTextProjectionCache.clear();
  liveMarkdownProjectionCache.clear();
  liveTextProjectionSourceChars = 0;
}

/**
 * Projects an append-only agent response without rescanning its accumulated
 * prefix. Completed line groups become immutable render segments; only the
 * small mutable tail crosses the React Native text bridge on the next flush.
 */
export function projectLiveTextAppend(
  previous: LiveTextProjection | null,
  source: string,
): LiveTextProjection {
  if (previous?.source === source) {
    return previous;
  }
  if (previous === null) {
    return consume({ remainder: "", segments: [], source: "" }, source, source);
  }
  if (looksAppendOnly(previous.source, source)) {
    return consume(previous, source.slice(previous.source.length), source);
  }
  const boundedDelta = boundedWindowAppend(previous.source, source);
  if (boundedDelta !== null) {
    return consume(previous, boundedDelta, source);
  }
  return consume({ remainder: "", segments: [], source: "" }, source, source);
}

function consume(previous: LiveTextProjection, delta: string, source: string): LiveTextProjection {
  const projected = projectMarkdownStream(previous.remainder, delta, false, {
    maxSegmentChars: LIVE_TEXT_MAX_PENDING_CHARS,
    targetSegmentChars: LIVE_TEXT_TARGET_SEGMENT_CHARS,
  });
  return {
    remainder: projected.remainder,
    segments:
      projected.segments.length === 0
        ? previous.segments
        : [...previous.segments, ...projected.segments],
    source,
  };
}

function looksAppendOnly(previous: string, source: string): boolean {
  if (source.length < previous.length) {
    return false;
  }
  if (source.length === previous.length) {
    return false;
  }
  if (previous.length === 0) {
    return true;
  }
  const marker = "\n… [earlier live output omitted] …\n";
  if (source.includes(marker) !== previous.includes(marker)) {
    return false;
  }
  const sample = Math.min(64, previous.length);
  return (
    source.slice(0, sample) === previous.slice(0, sample) &&
    source.slice(previous.length - sample, previous.length) === previous.slice(-sample)
  );
}

function boundedWindowAppend(previous: string, source: string): string | null {
  const marker = "\n… [earlier live output omitted] …\n";
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) {
    return null;
  }
  const previousMarkerIndex = previous.indexOf(marker);
  if (previousMarkerIndex >= 0 && previousMarkerIndex !== markerIndex) {
    return null;
  }
  const sample = Math.min(64, markerIndex);
  if (source.slice(0, sample) !== previous.slice(0, sample)) {
    return null;
  }
  const oldTail = previous.slice(
    previousMarkerIndex < 0 ? markerIndex : markerIndex + marker.length,
  );
  const newTail = source.slice(markerIndex + marker.length);
  const overlap = suffixPrefixOverlap(oldTail, newTail);
  return overlap <= 0 || overlap >= newTail.length ? null : newTail.slice(overlap);
}

function suffixPrefixOverlap(previous: string, next: string): number {
  const source = `${next}\u0000${previous}`;
  const prefix = new Uint32Array(source.length);
  for (let index = 1; index < source.length; index += 1) {
    let candidate = prefix[index - 1] ?? 0;
    while (candidate > 0 && source[index] !== source[candidate]) {
      candidate = prefix[candidate - 1] ?? 0;
    }
    if (source[index] === source[candidate]) {
      candidate += 1;
    }
    prefix[index] = Math.min(candidate, next.length);
  }
  return prefix[source.length - 1] ?? 0;
}
