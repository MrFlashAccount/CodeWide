import { describe, expect, it } from "vitest";

import {
  clearLiveTextProjectionCache,
  LIVE_TEXT_CACHE_MAX_ENTRIES,
  LIVE_TEXT_CACHE_MAX_SOURCE_CHARS,
  LIVE_TEXT_MAX_PENDING_CHARS,
  LIVE_TEXT_TARGET_SEGMENT_CHARS,
  liveTextProjectionCacheStats,
  projectCachedLiveMarkdown,
  projectCachedLiveText,
  projectLiveTextAppend,
  type LiveTextProjection,
} from "../src/rendering/live-text-stream";

describe("append-only live text projection", () => {
  it("bounds the process cache by entry count", () => {
    clearLiveTextProjectionCache();
    for (let index = 0; index < LIVE_TEXT_CACHE_MAX_ENTRIES + 5; index += 1) {
      projectCachedLiveText(`turn-${index}`, `value-${index}`);
    }
    expect(liveTextProjectionCacheStats()).toEqual({
      entries: LIVE_TEXT_CACHE_MAX_ENTRIES,
      sourceChars: Array.from({ length: LIVE_TEXT_CACHE_MAX_ENTRIES }, (_, index) => `value-${index + 5}`.length)
        .reduce((sum, length) => sum + length, 0),
    });
  });

  it("evicts cached streams when their retained source exceeds the byte budget", () => {
    clearLiveTextProjectionCache();
    const source = "x".repeat(Math.ceil(LIVE_TEXT_CACHE_MAX_SOURCE_CHARS / 2));
    projectCachedLiveText("first", source);
    projectCachedLiveText("second", source);
    projectCachedLiveText("third", source);

    const stats = liveTextProjectionCacheStats();
    expect(stats.entries).toBe(2);
    expect(stats.sourceChars).toBe(source.length * 2);
    expect(stats.sourceChars).toBeLessThanOrEqual(LIVE_TEXT_CACHE_MAX_SOURCE_CHARS);
  });

  it("keeps the completed prefix stable and consumes only the appended tail", () => {
    const firstSource = `${"first paragraph ".repeat(600)}\n\nmutable`;
    const first = projectLiveTextAppend(null, firstSource);
    const second = projectLiveTextAppend(first, `${firstSource} tail`);

    expect(first.segments.length).toBe(1);
    expect(second.segments).toBe(first.segments);
    expect(second.remainder).toBe("mutable tail");
    expect([...second.segments, second.remainder].join("")).toBe(`${firstSource} tail`);
  });

  it("projects one visible Markdown snapshot for both layout and rendering", () => {
    clearLiveTextProjectionCache();
    const first = projectCachedLiveMarkdown("agent", "Hello streaming wor");
    const second = projectCachedLiveMarkdown("agent", "Hello streaming word ");

    expect(first.visibleSource).toBe("Hello streaming ");
    expect(first.visibleRemainder).toBe("Hello streaming ");
    expect(second.visibleSource).toBe("Hello streaming word ");
    expect([...second.segments, second.remainder].join("")).toBe(second.source);
  });

  it("reveals the final word when the agent item has completed", () => {
    clearLiveTextProjectionCache();
    const streaming = projectCachedLiveMarkdown("completed-agent", "This fix will ship.");
    const completed = projectCachedLiveMarkdown("completed-agent", "This fix will ship.", true);

    expect(streaming.visibleSource).toBe("This fix will ");
    expect(completed.visibleSource).toBe("This fix will ship.");
  });

  it("bounds a pathological long line without losing its text", () => {
    const source = "x".repeat(LIVE_TEXT_MAX_PENDING_CHARS * 2);
    const projection = projectLiveTextAppend(null, source);

    expect(projection.segments.length).toBeGreaterThan(0);
    expect(Math.max(...projection.segments.map((segment) => segment.length))).toBeLessThanOrEqual(LIVE_TEXT_MAX_PENDING_CHARS);
    expect([...projection.segments, projection.remainder].join("")).toBe(source);
  });

  it("bounds every frozen segment when a large snapshot arrives at once", () => {
    const source = Array.from({ length: 2_000 }, (_, index) => `paragraph ${index}\n\n`).join("");
    const projection = projectLiveTextAppend(null, source);

    expect(Math.max(...projection.segments.map((segment) => segment.length))).toBeLessThan(LIVE_TEXT_TARGET_SEGMENT_CHARS + 32);
    expect([...projection.segments, projection.remainder].join("")).toBe(source);
  });

  it("bounds a live fenced code block without reparsing its accumulated prefix", () => {
    const source = `\`\`\`text\n${"x".repeat(LIVE_TEXT_MAX_PENDING_CHARS * 3)}\n\`\`\`\n`;
    const projection = projectLiveTextAppend(null, source);

    expect(projection.segments.length).toBeGreaterThan(1);
    expect(Math.max(...projection.segments.map((segment) => segment.length))).toBeLessThan(LIVE_TEXT_MAX_PENDING_CHARS + 32);
    expect(projection.remainder.length).toBeLessThan(LIVE_TEXT_MAX_PENDING_CHARS + 32);
  });

  it("resets safely when an authoritative value replaces the live prefix", () => {
    let projection: LiveTextProjection | null = projectLiveTextAppend(null, `${"a".repeat(900)}\n\nold`);
    projection = projectLiveTextAppend(projection, "replacement\n\nvalue");

    expect([...projection.segments, projection.remainder].join("")).toBe("replacement\n\nvalue");
  });

  it("keeps consuming the tail after the native live-field window starts sliding", () => {
    const marker = "\n… [earlier live output omitted] …\n";
    const head = "head\n\n";
    const oldTail = `${"line\n".repeat(1_000)}old`;
    const firstSource = `${head}${marker}${oldTail}`;
    const first = projectLiveTextAppend(null, firstSource);
    const delta = " appended";
    const nextTail = `${oldTail}${delta}`.slice(-oldTail.length);
    const second = projectLiveTextAppend(first, `${head}${marker}${nextTail}`);

    expect([...second.segments, second.remainder].join("")).toBe(`${firstSource}${delta}`);
  });

  it("does not reset when the native live-field window is introduced", () => {
    const marker = "\n… [earlier live output omitted] …\n";
    const head = `${"head paragraph\n\n".repeat(3_000)}`.slice(0, 48 * 1024);
    const firstSource = `${head}${"tail\n".repeat(3_000)}`;
    const first = projectLiveTextAppend(null, firstSource);
    const delta = "new output";
    const tailChars = 64 * 1024 - head.length - marker.length;
    const nextSource = `${head}${marker}${`${firstSource.slice(head.length)}${delta}`.slice(-tailChars)}`;
    const second = projectLiveTextAppend(first, nextSource);

    expect([...second.segments, second.remainder].join("")).toBe(`${firstSource}${delta}`);
  });
});
