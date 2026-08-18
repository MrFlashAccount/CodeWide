import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { describe, expect, it } from "vitest";

import {
  MAX_CACHED_THREAD_JSON_CHARS,
  MAX_CACHED_THREAD_TURNS,
  latestThreadMessagePreview,
  serializeThreadForCache,
} from "../src/data/thread-cache";

function threadWithTurns(turns: unknown[]): Thread {
  return { id: "thread", preview: "fixture", turns } as unknown as Thread;
}

describe("Android thread cache bounds", () => {
  it("projects the latest received message instead of the thread's first prompt", () => {
    const value = latestThreadMessagePreview(threadWithTurns([
      { id: "turn-1", items: [{ type: "userMessage", content: [{ type: "text", text: "First prompt", text_elements: [] }] }] },
      { id: "turn-2", items: [
        { type: "userMessage", content: [{ type: "text", text: "Latest prompt", text_elements: [] }] },
        { type: "agentMessage", text: "Latest answer" },
      ] },
    ]));

    expect(value).toBe("Latest answer");
  });

  it("strips transport metadata from the latest user preview", () => {
    const value = latestThreadMessagePreview(threadWithTurns([
      { id: "turn-1", items: [{
        type: "userMessage",
        content: [{ type: "text", text: "# Files mentioned by the user:\n\n## Photo.jpg: `/tmp/private.jpg`\n\n## My request for Codex:\n\nПокажи картинку", text_elements: [] }],
      }] },
    ]));

    expect(value).toBe("Покажи картинку");
  });

  it("projects Markdown as a compact plain-text thread subtitle", () => {
    const value = latestThreadMessagePreview(threadWithTurns([
      { id: "turn-1", items: [{
        type: "agentMessage",
        text: "## Result\n\n- **Fixed** [renderer](https://example.test) with `LegendList`",
      }] },
    ]));

    expect(value).toBe("Result Fixed renderer with LegendList");
  });

  it("keeps active progress in the subtitle until the phased final answer completes", () => {
    const active = latestThreadMessagePreview(threadWithTurns([{
      id: "turn",
      status: "inProgress",
      items: [
        { type: "agentMessage", text: "Still working", phase: "commentary" },
        { type: "agentMessage", text: "Final answer", phase: "final_answer" },
      ],
    }]));
    const completed = latestThreadMessagePreview(threadWithTurns([{
      id: "turn",
      status: "completed",
      items: [
        { type: "agentMessage", text: "Final answer", phase: "final_answer" },
        { type: "agentMessage", text: "Late progress", phase: "commentary" },
      ],
    }]));

    expect(active).toBe("Still working");
    expect(completed).toBe("Final answer");
  });

  it("keeps only the latest turn window", () => {
    const raw = serializeThreadForCache(threadWithTurns(
      Array.from({ length: 10 }, (_, index) => ({ id: `turn-${index}`, items: [] })),
    ));
    const parsed = JSON.parse(raw) as { turns: Array<{ id: string }> };

    expect(parsed.turns).toHaveLength(MAX_CACHED_THREAD_TURNS);
    expect(parsed.turns[0]?.id).toBe("turn-4");
  });

  it("drops old turns until the serialized row is below the hard cap", () => {
    const raw = serializeThreadForCache(threadWithTurns(
      Array.from({ length: 8 }, (_, index) => ({ id: `turn-${index}`, items: [{ text: "x".repeat(250_000) }] })),
    ));
    const parsed = JSON.parse(raw) as { turns: unknown[] };

    expect(raw.length).toBeLessThanOrEqual(MAX_CACHED_THREAD_JSON_CHARS);
    expect(parsed.turns.length).toBeGreaterThan(0);
    expect(parsed.turns.length).toBeLessThan(MAX_CACHED_THREAD_TURNS);
  });

  it("does not persist a single pathological turn", () => {
    const raw = serializeThreadForCache(threadWithTurns([
      { id: "huge", items: [{ text: "x".repeat(MAX_CACHED_THREAD_JSON_CHARS + 1) }] },
    ]));
    const parsed = JSON.parse(raw) as { turns: unknown[] };

    expect(parsed.turns).toEqual([]);
    expect(raw.length).toBeLessThan(MAX_CACHED_THREAD_JSON_CHARS);
  });

  it("keeps a contiguous recent window instead of rescanning oversized history", () => {
    const raw = serializeThreadForCache(threadWithTurns([
      { id: "old-small", items: [{ text: "old" }] },
      { id: "new-huge", items: [{ text: "x".repeat(MAX_CACHED_THREAD_JSON_CHARS + 1) }] },
    ]));
    const parsed = JSON.parse(raw) as { turns: unknown[] };

    expect(parsed.turns).toEqual([]);
  });
});
