import { performance } from "node:perf_hooks";

import { connectionId, KNOWN_ITEM_TYPES, normalizeThread } from "@codewide/domain";
import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { createLargeFixtureThread } from "@codewide/fixtures";
import { describe, expect, it } from "vitest";

import { renderRegistry, toRenderBlock } from "../src/index.js";

describe("renderer registry", () => {
  it("has an explicit renderer for every known App Server item", () => {
    expect(new Set(Object.keys(renderRegistry))).toEqual(KNOWN_ITEM_TYPES);
  });

  it("renders every item in a large deterministic fixture", () => {
    const fixture = createLargeFixtureThread(1_000);
    const server = connectionId("renderer-fixture");
    const items = normalizeThread(server, fixture).turns.flatMap((turn) => turn.items);
    const started = performance.now();
    const blocks = items.map(toRenderBlock);
    const elapsedMs = performance.now() - started;

    expect(blocks).toHaveLength(2_000);
    expect(blocks.filter((block) => block.kind === "unknown")).toEqual([]);
    expect(blocks.every((block) => block.title.length > 0)).toBe(true);
    expect(elapsedMs).toBeLessThan(2_000);
  });

  it("uses a bounded inspectable fallback for future items", () => {
    const block = toRenderBlock({
      key: "server/thread/turn/item",
      connectionId: connectionId("server"),
      threadId: "thread",
      turnId: "turn",
      itemId: "item",
      type: "futureThing",
      payload: { type: "futureThing", id: "item", content: "x".repeat(20_000) },
      unknown: true,
    });
    expect(block.kind).toBe("unknown");
    expect(block.body?.length).toBeLessThan(8_300);
    expect(block.raw).toEqual(expect.objectContaining({ type: "futureThing" }));
  });

  it("projects hook prompt fragments as Markdown instead of JSON", () => {
    const block = toRenderBlock({
      key: "server/thread/turn/hook",
      connectionId: connectionId("server"),
      threadId: "thread",
      turnId: "turn",
      itemId: "hook",
      type: "hookPrompt",
      payload: {
        type: "hookPrompt",
        id: "hook",
        fragments: [
          { text: "## Verify", hookRunId: "one" },
          { text: "- [x] Tests", hookRunId: "two" },
        ],
      },
      unknown: false,
    });
    expect(block.body).toBe("## Verify\n\n- [x] Tests");
  });

  it("keeps the latest thinking text when the server streams content without a summary", () => {
    const block = toRenderBlock({
      key: "server/thread/turn/reasoning",
      connectionId: connectionId("server"),
      threadId: "thread",
      turnId: "turn",
      itemId: "reasoning",
      type: "reasoning",
      payload: {
        type: "reasoning",
        id: "reasoning",
        summary: [],
        content: ["Inspecting history", "Planning pagination repair…"],
      },
      unknown: false,
    });
    expect(block.body).toBe("Inspecting history\nPlanning pagination repair…");
  });

  it("renders context compaction as a running lifecycle state until completion", () => {
    const running = toRenderBlock({
      key: "server/thread/turn/compaction",
      connectionId: connectionId("server"),
      threadId: "thread",
      turnId: "turn",
      itemId: "compaction",
      type: "contextCompaction",
      payload: { type: "contextCompaction", id: "compaction", codewideLifecyclePhase: "started" },
      unknown: false,
    });
    expect(running).toEqual(expect.objectContaining({
      title: "Compacting context",
      status: "inProgress",
    }));

    const completed = toRenderBlock({
      key: "server/thread/turn/compaction-completed",
      connectionId: connectionId("server"),
      threadId: "thread",
      turnId: "turn",
      itemId: "compaction",
      type: "contextCompaction",
      payload: { type: "contextCompaction", id: "compaction", codewideLifecyclePhase: "completed" },
      unknown: false,
    });
    expect(completed).toEqual(expect.objectContaining({
      title: "Context compacted",
      status: "completed",
    }));
  });

  it("projects a synthetic 20,000-item thread without dropping blocks", () => {
    const synthetic: Thread = {
      id: "synthetic-20k", extra: null, sessionId: "synthetic-20k", forkedFromId: null, parentThreadId: null,
      preview: "stress", ephemeral: false, section: null, sectionEnteredAt: null, historyMode: "paginated",
      modelProvider: "openai", createdAt: 1, updatedAt: 1, recencyAt: 1, status: { type: "idle" }, path: null,
      cwd: "/workspace", cliVersion: "0.147.0", source: "appServer", canAcceptDirectInput: true, threadSource: null,
      agentNickname: null, agentRole: null, gitInfo: null, name: "20k renderer stress",
      turns: [{
        id: "turn", itemsView: "full", status: "completed", error: null, startedAt: 1, completedAt: 2, durationMs: 1_000,
        items: Array.from({ length: 20_000 }, (_, index) => ({
          type: "agentMessage" as const,
          id: `item-${index}`,
          text: `Result ${index}`,
          phase: null,
          memoryCitation: null,
        })),
      }],
    };
    const started = performance.now();
    const blocks = normalizeThread(connectionId("synthetic-renderer"), synthetic).turns[0]?.items.map(toRenderBlock) ?? [];
    const elapsedMs = performance.now() - started;
    expect(blocks).toHaveLength(20_000);
    expect(blocks.every((block) => block.kind === "agentMessage")).toBe(true);
    expect(elapsedMs).toBeLessThan(2_000);
  });
});
