import type { Turn } from "@codewide/codex-protocol/v0.155.1/v2";
import { describe, expect, it } from "vitest";
import { projectedThreadExecutionSettings, projectedTurnMetadata } from "@codewide/sync-client";

import { ThreadSyncCatchUp, ThreadSyncLane, assertThreadSyncReachedHead, hydrateThreadSyncActiveText, latestSealedTurnId, materializeThreadSync, parseThreadSyncResponse } from "../src/data/thread-cursor-sync";

describe("thread cursor sync", () => {
  it("preserves reset and its cursor through subsequent catch-up pages", () => {
    const catchUp = new ThreadSyncCatchUp(thread([turn("obsolete")]), "old-cursor", "old-source");
    catchUp.accept({
      readModelVersion: 3, throughCursor: 1, thread: thread([]), activeTurn: null,
      history: { kind: "reset", headTurnId: "b", turns: [turn("a")], hasMore: true,
        olderCursor: "new-cursor", sourceWitness: "new-source" },
    });
    const result = catchUp.accept({
      readModelVersion: 3, throughCursor: 2, thread: thread([]), activeTurn: null,
      history: { kind: "delta", headTurnId: "b", turns: [turn("b")], hasMore: false,
        olderCursor: null, sourceWitness: "new-checkpoint" },
    });
    expect(catchUp.mode).toBe("reset");
    expect(catchUp.sourceWitness).toBe("new-checkpoint");
    expect(result.historyCursor).toBe("new-cursor");
    expect(result.thread.turns.map(({ id }) => id)).toEqual(["a", "b"]);
  });

  it("does not preserve text from an invalidated source during reset", () => {
    const prior = turn("live", "inProgress");
    prior.items = [{ delivery: null, questions: null, type: "agentMessage", id: "answer", text: "new obsolete suffix", phase: null, memoryCitation: null }];
    const next = turn("live", "inProgress");
    next.items = [{ delivery: null, questions: null, type: "agentMessage", id: "answer", text: "new", phase: null, memoryCitation: null }];
    next.itemsView = "summary";
    const result = materializeThreadSync(thread([prior]), {
      readModelVersion: 3, throughCursor: 2, thread: thread([]), activeTurn: next,
      history: { kind: "reset", headTurnId: null, turns: [], hasMore: false, olderCursor: null },
    }, undefined);
    expect(result.thread.turns[0]?.items).toEqual(next.items);
  });
  it("rejects oversized source checkpoints on authoritative sync", () => {
    expect(() => parseThreadSyncResponse({
      readModelVersion: 3, throughCursor: 0, thread: thread([]), activeTurn: null,
      history: { kind: "current", headTurnId: null, turns: [], hasMore: false,
        olderCursor: null, sourceWitness: "x".repeat(8192) },
    })).toThrow("invalid response");
  });

  it("keeps current server model through parsing and sync even when history and local settings are older", () => {
    const cached = Object.assign(thread([turn("a")]), { model: "gpt-5.6-sol", reasoningEffort: "medium" });
    const response = parseThreadSyncResponse({
      readModelVersion: 3,
      throughCursor: 0,
      thread: { ...thread([]), model: "gpt-6-astra", reasoningEffort: "high" },
      history: { kind: "current", headTurnId: "a", turns: [], hasMore: false, olderCursor: null },
      activeTurn: null,
    });
    const result = materializeThreadSync(cached, response, null);
    expect(result.thread.turns.map((item) => item.id)).toEqual(["a"]);
    expect(projectedThreadExecutionSettings(result.thread)).toMatchObject({ model: "gpt-6-astra", effort: "high" });
  });

  it("keeps immutable cache rows and appends only the server delta", () => {
    const cached = thread([turn("a"), turn("b"), turn("stale-active", "inProgress")]);
    const result = materializeThreadSync(cached, {
      readModelVersion: 3,
      throughCursor: 0,
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

  it("does not turn an unknown older-history cursor into an exhausted cursor", () => {
    const cached = thread([turn("a")]);
    const result = materializeThreadSync(cached, {
      readModelVersion: 3,
      throughCursor: 0,
      thread: thread([]),
      history: {
        kind: "current",
        headTurnId: "a",
        turns: [],
        hasMore: false,
        olderCursor: null,
      },
      activeTurn: null,
    }, undefined);

    expect(result.historyCursor).toBeUndefined();
  });

  it("replaces a disconnected cache with the bounded server reset", () => {
    const result = materializeThreadSync(thread([turn("wrong")]), {
      readModelVersion: 3,
      throughCursor: 0,
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

  it("settles each snapshot without waiting for later invalidations to stop", async () => {
    const lane = new ThreadSyncLane<number>();
    const snapshots = [Promise.withResolvers<number>(), Promise.withResolvers<number>(), Promise.withResolvers<number>()];
    let calls = 0;
    const synchronize = async (): Promise<number> => {
      const snapshot = snapshots[calls];
      calls += 1;
      if (snapshot === undefined) throw new Error("Unexpected extra snapshot request");
      return await snapshot.promise;
    };
    const first = lane.run("server/thread", synchronize);
    const next = lane.run("server/thread", synchronize, "afterCurrent");
    expect(next).not.toBe(first);
    expect(lane.run("server/thread", synchronize, "afterCurrent")).toBe(next);
    snapshots[0]?.resolve(1);
    await expect(first).resolves.toBe(1);

    // More events arrive while the next snapshot is pending. They must not
    // extend either of the already requested snapshots' completion boundary.
    const latest = lane.run("server/thread", synchronize, "afterCurrent");
    expect(latest).not.toBe(next);
    snapshots[1]?.resolve(2);
    await expect(next).resolves.toBe(2);
    snapshots[2]?.resolve(3);
    await expect(latest).resolves.toBe(3);
    expect(calls).toBe(3);
  });

  it("does not accept a pre-background snapshot as the foreground refresh", async () => {
    const lane = new ThreadSyncLane<string>();
    const oldSnapshot = Promise.withResolvers<string>();
    const freshSnapshot = Promise.withResolvers<string>();
    const oldRead = lane.run("server/thread", async () => await oldSnapshot.promise);
    let refreshed = false;
    const foreground = lane.run("server/thread", async () => {
      refreshed = true;
      return await freshSnapshot.promise;
    }, "afterCurrent");
    expect(refreshed).toBe(false);
    oldSnapshot.resolve("before sleep");
    await expect(oldRead).resolves.toBe("before sleep");
    expect(refreshed).toBe(true);
    freshSnapshot.resolve("from another device");
    await expect(foreground).resolves.toBe("from another device");
  });

  it("runs a requested fresh snapshot even if the preceding request fails", async () => {
    const lane = new ThreadSyncLane<number>();
    const pending = Promise.withResolvers<number>();
    const first = lane.run("server/thread", async () => await pending.promise);
    const failure = expect(first).rejects.toThrow("connection lost");
    const next = lane.run("server/thread", async () => 2, "afterCurrent");
    pending.reject(new Error("connection lost"));
    await failure;
    await expect(next).resolves.toBe(2);
  });

  it("reports a failed follow-up without rejecting an already applied snapshot", async () => {
    const lane = new ThreadSyncLane<number>();
    const pending = Promise.withResolvers<number>();
    const first = lane.run("server/thread", async () => await pending.promise);
    const next = lane.run("server/thread", async () => { throw new Error("refresh failed"); }, "afterCurrent");
    const failure = expect(next).rejects.toThrow("refresh failed");
    pending.resolve(1);
    await expect(first).resolves.toBe(1);
    await failure;
    await expect(lane.run("server/thread", async () => 3)).resolves.toBe(3);
  });

  it("does not block other threads or connections behind a pending snapshot", async () => {
    const lane = new ThreadSyncLane<number>();
    const pending = Promise.withResolvers<number>();
    const first = lane.run("server/thread", async () => await pending.promise);
    await expect(lane.run("server/other-thread", async () => 2)).resolves.toBe(2);
    await expect(lane.run("other-server/thread", async () => 3)).resolves.toBe(3);
    pending.resolve(1);
    await expect(first).resolves.toBe(1);
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
      readModelVersion: 3,
      throughCursor: 0,
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
      readModelVersion: 3,
      throughCursor: 0,
      thread: { id: "thread", cwd: "/workspace", status: { type: "idle" } },
      history: { kind: "current", headTurnId: null, turns: [], hasMore: false, olderCursor: null },
      activeTurn: null,
    })).toThrow("invalid response");
  });

  it("materializes metadata-only recovery turns at the Conversation boundary", () => {
    const response = parseThreadSyncResponse({
      readModelVersion: 3,
      throughCursor: 0,
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
      readModelVersion: 3,
      throughCursor: 0,
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

  it("hydrates externalized active agent text before merging the recovery checkpoint", async () => {
    const reference = {
      id: "a".repeat(64),
      byteLength: 24_000,
      contentType: "text/markdown; charset=utf-8",
    };
    const response = parseThreadSyncResponse({
      readModelVersion: 3,
      throughCursor: 0,
      thread: thread([]),
      history: { kind: "current", headTurnId: null, turns: [], hasMore: false, olderCursor: null },
      activeTurn: {
        ...turn("active", "inProgress"),
        items: [{
          delivery: null,
          questions: null,
          id: "active-agent",
          type: "agentMessage",
          text: "bounded preview",
          phase: null,
          memoryCitation: null,
          codewideContent: { version: 1, fields: { "/text": reference } },
        }],
      },
    });

    const hydrated = await hydrateThreadSyncActiveText(response, async (received) => {
      expect(received).toEqual(reference);
      return "complete active response";
    });

    expect(hydrated.activeTurn?.items).toMatchObject([{ text: "complete active response" }]);
  });

  it("repairs an empty cached active turn from sync without clearing sealed history", () => {
    const sealed = turn("sealed");
    const emptyActive = turn("active", "inProgress", false);
    emptyActive.itemsView = "notLoaded";
    const live = turn("active", "inProgress");
    live.itemsView = "full";
    const response = parseThreadSyncResponse({
      readModelVersion: 3,
      throughCursor: 0,
      thread: thread([]),
      history: { kind: "current", headTurnId: "sealed", turns: [], hasMore: false, olderCursor: null },
      activeTurn: live,
    });

    const result = materializeThreadSync(thread([sealed, emptyActive]), response, "older");

    expect(result.thread.turns).toEqual([sealed, live]);
    expect(result.thread.turns[0]).toBe(sealed);
    expect(result.thread.turns[1]?.items).toEqual(live.items);
    expect(result.historyCursor).toBe("older");
  });

  it("merges a bounded active checkpoint without discarding streamed activity", () => {
    const sealed = turn("sealed");
    const cachedActive: Turn = {
      id: "active",
      itemsView: "full",
      status: "inProgress",
      error: null,
      startedAt: 2,
      completedAt: null,
      durationMs: null,
      items: [
        { id: "user", type: "userMessage", clientId: "client", content: [{ type: "text", text: "Run", text_elements: [] }] },
        { id: "command", type: "commandExecution", pluginId: null, scriptPath: null, command: "pnpm test", cwd: "/workspace", processId: null, source: "agent", status: "completed", commandActions: [], aggregatedOutput: "passed", exitCode: 0, durationMs: 10 },
        { delivery: null, questions: null, id: "agent", type: "agentMessage", text: "Still working", phase: null, memoryCitation: null },
      ],
    };
    const cachedWithMetadata = Object.assign(cachedActive, {
      codewide: {
        diff: "locally streamed diff",
        activity: { count: 1, kinds: ["commandExecution"] },
      },
    });
    const checkpoint: Turn = {
      ...cachedWithMetadata,
      codewide: {
        activity: { count: 2, kinds: ["commandExecution", "agentMessage"] },
      },
      itemsView: "summary",
      items: [
        { id: "user", type: "userMessage", clientId: "client", content: [{ type: "text", text: "Run", text_elements: [] }] },
        { delivery: null, questions: null, id: "agent", type: "agentMessage", text: "Still working on the final answer", phase: null, memoryCitation: null },
      ],
    };

    const result = materializeThreadSync(thread([sealed, cachedWithMetadata]), {
      readModelVersion: 3,
      throughCursor: 0,
      thread: thread([]),
      history: { kind: "current", headTurnId: "sealed", turns: [], hasMore: false, olderCursor: null },
      activeTurn: checkpoint,
    }, "older");

    expect(result.thread.turns[0]).toBe(sealed);
    expect(result.thread.turns[1]).toMatchObject({ id: "active", itemsView: "full" });
    expect(result.thread.turns[1]?.items).toMatchObject([
      { id: "user" },
      { id: "command", aggregatedOutput: "passed" },
      { id: "agent", text: "Still working on the final answer" },
    ]);
    expect(projectedTurnMetadata(result.thread.turns[1]!)).toMatchObject({
      diff: "locally streamed diff",
      activity: { count: 2, kinds: ["commandExecution", "agentMessage"] },
    });
  });

  it("keeps the observed active transcript when a foreground full checkpoint is shorter", () => {
    const sealed = turn("sealed");
    const cachedActive: Turn = {
      id: "active",
      itemsView: "full",
      status: "inProgress",
      error: null,
      startedAt: 2,
      completedAt: null,
      durationMs: null,
      items: [
        { id: "user", type: "userMessage", clientId: "client", content: [{ type: "text", text: "Run", text_elements: [] }] },
        { delivery: null, questions: null, id: "progress-before-compaction", type: "agentMessage", text: "First update", phase: "commentary", memoryCitation: null },
        { id: "command", type: "commandExecution", pluginId: null, scriptPath: null, command: "pnpm test", cwd: "/workspace", processId: null, source: "agent", status: "completed", commandActions: [], aggregatedOutput: "passed", exitCode: 0, durationMs: 10 },
        { id: "compaction", type: "contextCompaction", codewideLifecyclePhase: "completed" },
        { delivery: null, questions: null, id: "latest", type: "agentMessage", text: "Latest update", phase: "commentary", memoryCitation: null },
      ],
    };
    const foregroundCheckpoint: Turn = {
      ...cachedActive,
      items: [
        { id: "compaction", type: "contextCompaction" },
        { delivery: null, questions: null, id: "latest", type: "agentMessage", text: "Latest update", phase: "commentary", memoryCitation: null },
      ],
    };

    const result = materializeThreadSync(thread([sealed, cachedActive]), {
      readModelVersion: 3,
      throughCursor: 0,
      thread: thread([]),
      history: { kind: "current", headTurnId: "sealed", turns: [], hasMore: false, olderCursor: null },
      activeTurn: foregroundCheckpoint,
    }, null);

    expect(result.thread.turns[0]).toBe(sealed);
    expect(result.thread.turns[1]).toMatchObject({ id: "active", itemsView: "full" });
    expect(result.thread.turns[1]?.items.map(({ id }) => id)).toEqual([
      "user",
      "progress-before-compaction",
      "command",
      "compaction",
      "latest",
    ]);
    expect(result.thread.turns[1]?.items.find(({ id }) => id === "compaction")).toEqual(
      expect.objectContaining({ codewideLifecyclePhase: "completed" }),
    );
  });

  it("replaces an offline partial active turn with its sealed checkpoint", () => {
    const partial = turn("active", "inProgress");
    const completed = turn("active", "completed");
    const result = materializeThreadSync(thread([partial]), {
      readModelVersion: 3,
      throughCursor: 0,
      thread: thread([]),
      history: { kind: "reset", headTurnId: "active", turns: [completed], hasMore: false, olderCursor: null },
      activeTurn: null,
    }, "stale");

    expect(result.thread.turns).toEqual([completed]);
    expect(result.thread.turns[0]?.status).toBe("completed");
  });

  it("keeps an unreferenced malformed active turn as a Conversation sync failure", () => {
    expect(() => parseThreadSyncResponse({
      readModelVersion: 3,
      throughCursor: 0,
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
      readModelVersion: 3,
      throughCursor: 0,
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
      readModelVersion: 3,
      throughCursor: 0,
      thread: thread([]),
      history: { kind: "current", headTurnId: "cached", turns: [], hasMore: false, olderCursor: null },
      activeTurn: null,
    }, "cached")).not.toThrow();
    expect(() => assertThreadSyncReachedHead({
      readModelVersion: 3,
      throughCursor: 0,
      thread: thread([]),
      history: { kind: "delta", headTurnId: "new", turns: [turn("new")], hasMore: false, olderCursor: null },
      activeTurn: null,
    }, "cached")).not.toThrow();
    expect(() => assertThreadSyncReachedHead({
      readModelVersion: 3,
      throughCursor: 0,
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
      delivery: null,
      questions: null,
      id: `${id}-agent`,
      type: "agentMessage",
      text: "done",
      phase: "final_answer",
      memoryCitation: null,
    }] : [],
  };
}

function thread(turns: Turn[]): import("@codewide/codex-protocol/v0.155.1/v2").Thread {
  return {
    environments: null,
    projectId: null,
    model: null,
    reasoningEffort: null,
    originator: null,
    daybreakEnabled: null,
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
