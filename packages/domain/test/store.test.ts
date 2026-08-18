import { performance } from "node:perf_hooks";

import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { createLargeFixtureThread } from "@codewide/fixtures";
import { describe, expect, it } from "vitest";

import { connectionId, DomainStore, normalizeThread } from "../src/index.js";

const minimalThread = (id: string, updatedAt: number): Thread =>
  ({
    id,
    extra: null,
    sessionId: `session-${id}`,
    forkedFromId: null,
    parentThreadId: null,
    preview: "preview",
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    historyMode: "paginated",
    modelProvider: "openai",
    createdAt: updatedAt,
    updatedAt,
    recencyAt: updatedAt,
    status: { type: "idle" },
    path: null,
    cwd: "/workspace",
    cliVersion: "0.147.0",
    source: "cli",
    canAcceptDirectInput: null,
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
  }) as Thread;

describe("DomainStore", () => {
  it("isolates identical remote thread ids across connections", () => {
    const first = connectionId("first");
    const second = connectionId("second");
    const store = new DomainStore();
    store.upsertConnection({
      id: first,
      displayName: "First",
      emoji: "🚀",
      endpoint: "wss://first.invalid",
      enabled: true,
      sortOrder: 0,
      state: "live",
      lastSeenAt: null,
      syncCursor: null,
    });
    store.upsertConnection({
      id: second,
      displayName: "Second",
      emoji: "🧪",
      endpoint: "wss://second.invalid",
      enabled: true,
      sortOrder: 1,
      state: "live",
      lastSeenAt: null,
      syncCursor: null,
    });
    store.upsertThread(first, minimalThread("same-id", 1));
    store.upsertThread(second, minimalThread("same-id", 2));

    expect(store.aggregatedThreads().map((thread) => thread.connectionId)).toEqual([
      second,
      first,
    ]);
    expect(store.getThread(first, "same-id")?.key).not.toBe(
      store.getThread(second, "same-id")?.key,
    );
  });

  it("normalizes a large deterministic fixture without dropping items", () => {
    const fixture = createLargeFixtureThread(1_000);
    const server = connectionId("fixture");
    const started = performance.now();
    const normalized = normalizeThread(server, fixture);
    const elapsedMs = performance.now() - started;
    const items = normalized.turns.flatMap((turn) => turn.items);

    expect(items).toHaveLength(2_000);
    expect(new Set(items.map((item) => item.type))).toEqual(new Set(["userMessage", "agentMessage"]));
    expect(items.filter((item) => item.unknown)).toEqual([]);
    expect(elapsedMs).toBeLessThan(2_000);
  });

  it("preserves unknown future items as safe fallback payloads", () => {
    const raw = minimalThread("future", 1);
    raw.turns = [
      {
        id: "turn",
        status: "completed",
        error: null,
        startedAt: 1,
        completedAt: 2,
        durationMs: 1,
        itemsView: "full",
        items: [{ type: "futureRichThing", id: "future-item", payload: 42 } as never],
      },
    ];
    const normalized = normalizeThread(connectionId("server"), raw);
    expect(normalized.turns[0]?.items[0]).toEqual(
      expect.objectContaining({
        type: "futureRichThing",
        unknown: true,
        payload: { type: "futureRichThing", id: "future-item", payload: 42 },
      }),
    );
  });
});
