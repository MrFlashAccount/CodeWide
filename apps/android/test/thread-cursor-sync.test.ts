import type { Turn } from "@codewide/codex-protocol/v0.147.0/v2";
import { describe, expect, it } from "vitest";

import { ThreadSyncLane, assertThreadSyncReachedHead, latestSealedTurnId, materializeThreadSync, parseThreadSyncResponse } from "../src/data/thread-cursor-sync";

describe("thread cursor sync", () => {
  it("keeps immutable cache rows and appends only the server delta", () => {
    const cached = thread([turn("a"), turn("b"), turn("stale-active", "inProgress")]);
    const result = materializeThreadSync(cached, {
      readModelVersion: 2,
      thread: thread([]),
      history: {
        kind: "delta",
        headTurnId: "d",
        turns: [turn("c"), turn("d")],
        hasMore: false,
        olderCursor: null,
      },
      activeTurn: turn("live", "inProgress"),
    }, "older");

    expect(result.thread.turns.map(({ id }) => id)).toEqual(["a", "b", "c", "d", "live"]);
    expect(result.historyCursor).toBe("older");
  });

  it("replaces a disconnected cache with the bounded server reset", () => {
    const result = materializeThreadSync(thread([turn("wrong")]), {
      readModelVersion: 2,
      thread: thread([]),
      history: {
        kind: "reset",
        headTurnId: "b",
        turns: [turn("a"), turn("b")],
        hasMore: false,
        olderCursor: "older-reset",
      },
      activeTurn: null,
    }, "ignored");

    expect(result.thread.turns.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(result.historyCursor).toBe("older-reset");
  });

  it("reruns one authoritative sync when a live event arrives during it", async () => {
    const lane = new ThreadSyncLane<number>();
    const resolvers: Array<(value: number) => void> = [];
    let calls = 0;
    const result = lane.run("server/thread", async () => await new Promise<number>((resolve) => {
      calls += 1;
      resolvers.push(resolve);
    }));

    await Promise.resolve();
    expect(lane.markDirty("server/thread")).toBe(true);
    resolvers[0]?.(1);
    await Promise.resolve();
    await Promise.resolve();
    resolvers[1]?.(2);

    await expect(result).resolves.toBe(2);
    expect(calls).toBe(2);
  });

  it("coalesces concurrent readers without scheduling an unnecessary second sync", async () => {
    let resolve: ((value: number) => void) | undefined;
    let calls = 0;
    const lane = new ThreadSyncLane<number>();
    const synchronize = async (): Promise<number> => await new Promise<number>((currentResolve) => {
      calls += 1;
      resolve = currentResolve;
    });

    const first = lane.run("server/thread", synchronize);
    const second = lane.run("server/thread", synchronize);
    expect(first).toBe(second);
    resolve?.(1);

    await expect(first).resolves.toBe(1);
    expect(calls).toBe(1);
  });

  it("preserves an authoritative completed turn without a final-answer phase", () => {
    const unphased = {
      ...turn("unphased"),
      items: [{
        id: "agent-unphased",
        type: "agentMessage" as const,
        text: "done",
        phase: null,
      }],
    };
    const result = materializeThreadSync(thread([unphased]), {
      readModelVersion: 2,
      thread: thread([]),
      history: {
        kind: "current",
        headTurnId: "unphased",
        turns: [],
        hasMore: false,
        olderCursor: null,
      },
      activeTurn: null,
    }, null);

    expect(result.thread.turns).toEqual([unphased]);
  });

  it("rejects a malformed transport response before it reaches projection code", () => {
    expect(() => parseThreadSyncResponse({
      readModelVersion: 2,
      thread: { id: "thread", cwd: "/workspace", status: { type: "idle" } },
      history: { kind: "current", headTurnId: null, turns: [], hasMore: false, olderCursor: null },
      activeTurn: null,
    })).toThrow("invalid response");
  });

  it("materializes metadata-only recovery turns at the Conversation boundary", () => {
    const response = parseThreadSyncResponse({
      readModelVersion: 2,
      thread: thread([]),
      history: {
        kind: "reset",
        headTurnId: "legacy",
        turns: [{
          id: "legacy",
          status: "interrupted",
          error: null,
          startedAt: 1,
          completedAt: 2,
          durationMs: 1,
        }],
        hasMore: false,
        olderCursor: null,
      },
      activeTurn: null,
    });

    expect(response.history.turns).toEqual([{
      id: "legacy",
      items: [],
      itemsView: "notLoaded",
      status: "interrupted",
      error: null,
      startedAt: 1,
      completedAt: 2,
      durationMs: 1,
    }]);
  });

  it("materializes a size-bounded active turn at the Conversation boundary", () => {
    const contentReference = {
      version: 1 as const,
      fields: {},
      whole: {
        id: "content-digest",
        byteLength: 311_730,
        contentType: "application/json",
      },
    };
    const response = parseThreadSyncResponse({
      readModelVersion: 2,
      thread: thread([]),
      history: {
        kind: "current",
        headTurnId: null,
        turns: [],
        hasMore: false,
        olderCursor: null,
      },
      activeTurn: {
        id: "active",
        itemsView: "full",
        status: "inProgress",
        error: null,
        startedAt: 1,
        completedAt: null,
        durationMs: null,
        codewideContent: contentReference,
      },
    });

    const result = materializeThreadSync(null, response, null);

    expect(result.thread.turns).toEqual([{
      id: "active",
      items: [],
      itemsView: "notLoaded",
      status: "inProgress",
      error: null,
      startedAt: 1,
      completedAt: null,
      durationMs: null,
      codewideContent: contentReference,
    }]);
  });

  it("keeps an unreferenced malformed active turn as a Conversation sync failure", () => {
    expect(() => parseThreadSyncResponse({
      readModelVersion: 2,
      thread: thread([]),
      history: {
        kind: "current",
        headTurnId: null,
        turns: [],
        hasMore: false,
        olderCursor: null,
      },
      activeTurn: { id: "active", status: "inProgress" },
    })).toThrow("invalid response");
  });

  it("rejects a terminal delta that did not reach the server head", () => {
    expect(() => assertThreadSyncReachedHead({
      readModelVersion: 2,
      thread: thread([]),
      history: {
        kind: "delta",
        headTurnId: "missing-head",
        turns: [turn("partial")],
        hasMore: false,
        olderCursor: null,
      },
      activeTurn: null,
    }, "cached")).toThrow("advertised history head");
  });

  it("accepts current, delta, and reset responses only after reaching their head", () => {
    expect(() => assertThreadSyncReachedHead({
      readModelVersion: 2,
      thread: thread([]),
      history: { kind: "current", headTurnId: "cached", turns: [], hasMore: false, olderCursor: null },
      activeTurn: null,
    }, "cached")).not.toThrow();
    expect(() => assertThreadSyncReachedHead({
      readModelVersion: 2,
      thread: thread([]),
      history: { kind: "delta", headTurnId: "new", turns: [turn("new")], hasMore: false, olderCursor: null },
      activeTurn: null,
    }, "cached")).not.toThrow();
    expect(() => assertThreadSyncReachedHead({
      readModelVersion: 2,
      thread: thread([]),
      history: { kind: "reset", headTurnId: "tail", turns: [turn("tail")], hasMore: false, olderCursor: "older" },
      activeTurn: null,
    }, "disconnected")).not.toThrow();
  });

  it("uses the latest completed turn as the stable cursor", () => {
    expect(latestSealedTurnId([turn("a"), turn("b"), turn("live", "inProgress")])).toBe("b");
    expect(latestSealedTurnId([turn("live", "inProgress")])).toBeNull();
  });

  it("does not anchor after a completed turn whose final text is still missing", () => {
    expect(latestSealedTurnId([
      turn("stable"),
      { ...turn("incomplete"), items: [] },
    ])).toBe("stable");
    expect(latestSealedTurnId([{ ...turn("incomplete"), items: [] }])).toBeNull();
    expect(latestSealedTurnId([turn("interrupted", "interrupted", false)])).toBe("interrupted");
  });

  it("does not treat non-empty commentary as a final cursor boundary", () => {
    const commentary = turn("commentary");
    const agent = commentary.items[0] as Extract<Turn["items"][number], { type: "agentMessage" }>;
    agent.phase = "commentary";

    expect(latestSealedTurnId([turn("stable"), commentary])).toBe("stable");
  });

  it("does not trust an unphased live completion as a stable cursor", () => {
    const unphased = turn("unphased");
    const agent = unphased.items[0] as Extract<Turn["items"][number], { type: "agentMessage" }>;
    agent.phase = null;

    expect(latestSealedTurnId([unphased])).toBeNull();
  });
});

function turn(id: string, status: Turn["status"] = "completed", withAgent = true): Turn {
  return {
    id,
    itemsView: "summary",
    status,
    error: null,
    startedAt: 1,
    completedAt: status === "inProgress" ? null : 2,
    durationMs: status === "inProgress" ? null : 1,
    items: withAgent ? [{
      id: `${id}-agent`,
      type: "agentMessage",
      text: "done",
      phase: "final_answer",
      memoryCitation: null,
    }] : [],
  };
}

function thread(turns: Turn[]): import("@codewide/codex-protocol/v0.147.0/v2").Thread {
  return {
    id: "thread",
    preview: "",
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 1,
    status: { type: turns.some(({ status }) => status === "inProgress") ? "active" : "idle" },
    path: null,
    cwd: "/workspace",
    cliVersion: "test",
    source: "appServer",
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns,
  };
}
