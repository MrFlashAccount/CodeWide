import type { Thread, Turn } from "@codewide/codex-protocol/v0.147.0/v2";
import { describe, expect, it } from "vitest";

import {
  compactCompletedTurnForStorage,
  authoritativeTimelineRowId,
  materializePendingTimeline,
  materializeThreadDetails,
  materializeThreadTurns,
  mergePendingTimelineOverlays,
  mergePendingTimelineEntry,
  pendingTimelineRowId,
  planPendingDeliveryProjectionCleanup,
  planQueuedMoveMutation,
  projectAuthoritativeHistoryEpoch,
  projectAuthoritativeTurnOrdinals,
  projectPrependedTurnOrdinals,
  reconcileAuthoritativeThread,
  reconcileAuthoritativeThreadDetailRow,
  reusableTurnOrdinal,
  selectLiveThreadDetailRows,
  shouldApplyLiveThreadRow,
  shouldWriteAuthoritativeThreadDetailRow,
  shouldWriteHydratedActivityRow,
  shouldWriteThreadDetailRow,
  type ThreadDetailRow,
} from "../src/data/thread-detail-projection";
import { shouldRefreshInvalidatedThread } from "../src/data/thread-detail-invalidation";

const status = { type: "idle" } as const;

function row(overrides: Partial<ThreadDetailRow>): ThreadDetailRow {
  return {
    id: "row",
    kind: "turn",
    connectionId: "server",
    remoteThreadId: "thread",
    remoteTurnId: "turn",
    historyEpoch: 0,
    ordinal: 0,
    sessionId: null,
    lastOpenedAt: 0,
    sealed: true,
    thread: null,
    turn: null,
    turnMetadata: null,
    activityItems: null,
    ...overrides,
  };
}

function turn(): Turn {
  return { id: "turn", status: "completed", items: [], startedAt: 1, completedAt: 2 } as unknown as Turn;
}

describe("thread detail projection", () => {
  it("keeps optimistic rows and tombstones atomic over an older SQLite window", () => {
    const stalePending = row({ id: "client", kind: "pending", sealed: false, remoteTurnId: null });
    const optimisticPending = row({ ...stalePending, lastOpenedAt: 2 });
    const otherThread = row({ id: "other", remoteThreadId: "other-thread" });

    expect(mergePendingTimelineOverlays(
      [stalePending],
      [{ key: "client", connectionId: "server", threadId: "thread", row: optimisticPending }],
      "server",
      "thread",
    )).toEqual([optimisticPending]);
    expect(mergePendingTimelineOverlays(
      [stalePending, otherThread],
      [{ key: "client", connectionId: "server", threadId: "thread", row: null }],
      "server",
      "thread",
    )).toEqual([otherThread]);
  });

  it("lets an authoritative stable-client-id turn win over a pending overlay", () => {
    const authoritative = row({ id: "client", kind: "turn", ordinal: 7 });
    const optimistic = row({ id: "client", kind: "pending", sealed: false, remoteTurnId: null, ordinal: 1_000_000 });

    expect(mergePendingTimelineOverlays(
      [authoritative],
      [{ key: "client", connectionId: "server", threadId: "thread", row: optimistic }],
      "server",
      "thread",
    )).toEqual([authoritative]);
    expect(reusableTurnOrdinal(optimistic, 0)).toBeNull();
    expect(reusableTurnOrdinal(authoritative, 0)).toBe(7);
  });

  it("extends global ordinals from an overlapping authoritative tail page", () => {
    const existing = [
      row({ remoteTurnId: "turn-0", ordinal: 0 }),
      row({ remoteTurnId: "turn-1", ordinal: 1 }),
      row({ remoteTurnId: "turn-2", ordinal: 2 }),
      row({ remoteTurnId: "turn-3", ordinal: 3 }),
      row({ remoteTurnId: "turn-4", ordinal: 4 }),
      row({ remoteTurnId: "turn-5", ordinal: 5 }),
    ];

    expect(Array.from(projectAuthoritativeTurnOrdinals(existing, ["turn-4", "turn-5", "turn-6", "turn-7"]))).toEqual([
      ["turn-4", 4],
      ["turn-5", 5],
      ["turn-6", 6],
      ["turn-7", 7],
    ]);
  });

  it("appends an authoritative tail after the persisted maximum when no turn overlaps", () => {
    const existing = [
      row({ remoteTurnId: "old-20", ordinal: 20 }),
      row({ remoteTurnId: "old-21", ordinal: 21 }),
    ];

    expect(Array.from(projectAuthoritativeTurnOrdinals(existing, ["new-1", "new-2"]))).toEqual([
      ["new-1", 22],
      ["new-2", 23],
    ]);
  });

  it("isolates a disconnected authoritative tail and prepends cursor pages inside its epoch", () => {
    const oldIsland = [
      row({ id: "meta", kind: "thread", remoteTurnId: null, historyEpoch: 0, ordinal: -1 }),
      ...Array.from({ length: 6 }, (_, index) => row({
        id: `old-${index}`,
        remoteTurnId: `old-${index}`,
        historyEpoch: 0,
        ordinal: index,
      })),
    ];
    const tailIds = Array.from({ length: 6 }, (_, index) => `new-${index + 15}`);
    const nextEpoch = projectAuthoritativeHistoryEpoch(oldIsland, tailIds);
    expect(nextEpoch).toBe(1);

    const tailOrdinals = projectAuthoritativeTurnOrdinals([], tailIds);
    const withTail = [
      ...oldIsland,
      ...tailIds.map((turnId) => row({
        id: turnId,
        remoteTurnId: turnId,
        historyEpoch: nextEpoch,
        ordinal: tailOrdinals.get(turnId),
      })),
    ];
    const firstOlderIds = Array.from({ length: 12 }, (_, index) => `new-${index + 3}`);
    const firstOlderOrdinals = projectPrependedTurnOrdinals(withTail, nextEpoch, firstOlderIds);
    expect(firstOlderIds.map((turnId) => firstOlderOrdinals.get(turnId))).toEqual(
      Array.from({ length: 12 }, (_, index) => index - 12),
    );

    const withFirstOlder = [
      ...withTail,
      ...firstOlderIds.map((turnId) => row({
        id: turnId,
        remoteTurnId: turnId,
        historyEpoch: nextEpoch,
        ordinal: firstOlderOrdinals.get(turnId),
      })),
    ];
    const secondOlderIds = [
      ...Array.from({ length: 6 }, (_, index) => `old-${index}`),
      "new-0",
      "new-1",
      "new-2",
    ];
    const secondOlderOrdinals = projectPrependedTurnOrdinals(withFirstOlder, nextEpoch, secondOlderIds);
    expect(secondOlderIds.map((turnId) => secondOlderOrdinals.get(turnId))).toEqual(
      Array.from({ length: 9 }, (_, index) => index - 21),
    );

    const migratedRows = new Map<string, ThreadDetailRow>();
    for (const candidate of [...withTail, ...withFirstOlder]) {
      if (candidate.remoteTurnId !== null) migratedRows.set(candidate.remoteTurnId, candidate);
    }
    for (const turnId of secondOlderIds) {
      migratedRows.set(turnId, row({
        id: turnId,
        remoteTurnId: turnId,
        historyEpoch: nextEpoch,
        ordinal: secondOlderOrdinals.get(turnId),
      }));
    }
    expect([...migratedRows.values()]
      .filter((candidate) => candidate.historyEpoch === nextEpoch)
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((candidate) => candidate.remoteTurnId)).toEqual([
      ...secondOlderIds,
      ...firstOlderIds,
      ...tailIds,
    ]);
  });

  it("starts a new epoch when a lone live overlap would collide with older ordinals", () => {
    const existing = [
      row({ id: "meta", kind: "thread", remoteTurnId: null, historyEpoch: 4, ordinal: -1 }),
      row({ remoteTurnId: "old-0", historyEpoch: 4, ordinal: 0 }),
      row({ remoteTurnId: "old-1", historyEpoch: 4, ordinal: 1 }),
      row({ remoteTurnId: "live-edge", historyEpoch: 4, ordinal: 2 }),
    ];

    expect(projectAuthoritativeHistoryEpoch(existing, ["missed-0", "missed-1", "live-edge"])).toBe(5);
  });

  it("persists a repaired ordinal even when sealed content is unchanged", () => {
    const content = turn();
    const previous = row({ ordinal: 0, turn: content, sealed: true });
    const next = row({ ordinal: 6, turn: content, sealed: true });

    expect(shouldWriteAuthoritativeThreadDetailRow(previous, next)).toBe(true);
  });

  it("does not let a late optimistic acceptance revive a delivered message", () => {
    const delivered = {
      commandId: "command",
      method: "turn/steer" as const,
      presentation: "delivery" as const,
      text: "already sent",
      attachments: [],
      state: "delivered" as const,
      attempts: 1,
      lastError: null,
      createdAt: 10,
      updatedAt: 20,
      order: 10,
    };

    expect(mergePendingTimelineEntry(delivered, {
      ...delivered,
      state: "accepted",
      updatedAt: 21,
    })).toBe(delivered);
  });

  it("accepts definitive native delivery even when its timestamp predates the optimistic write", () => {
    const accepted = {
      commandId: "command",
      method: "turn/steer" as const,
      presentation: "delivery" as const,
      text: "already sent",
      attachments: [],
      state: "accepted" as const,
      attempts: 1,
      lastError: null,
      createdAt: 10,
      updatedAt: 21,
      order: 10,
    };

    expect(mergePendingTimelineEntry(accepted, {
      ...accepted,
      state: "delivered",
      updatedAt: 20,
    }).state).toBe("delivered");
  });

  it("still lets an explicit retry leave a failed state", () => {
    const failed = {
      commandId: "command",
      method: "turn/steer" as const,
      presentation: "delivery" as const,
      text: "retry me",
      attachments: [],
      state: "failed" as const,
      attempts: 1,
      lastError: "offline",
      createdAt: 10,
      updatedAt: 20,
      order: 10,
    };

    expect(mergePendingTimelineEntry(failed, {
      ...failed,
      state: "sending",
      attempts: 2,
      lastError: null,
      updatedAt: 21,
    }).state).toBe("sending");
  });

  it("plans a queue move as one atomic two-row mutation", () => {
    const pending = (commandId: string, order: number) => row({
      id: commandId,
      kind: "pending",
      remoteTurnId: null,
      sealed: false,
      pending: {
        commandId,
        method: "turn/start",
        presentation: "queue",
        text: commandId,
        attachments: [],
        state: "queued",
        attempts: 0,
        lastError: null,
        createdAt: order,
        updatedAt: order,
        order,
      },
    });
    const mutation = planQueuedMoveMutation([pending("a", 1), pending("b", 2), pending("c", 3)], "b", -1, 10);
    expect(mutation?.upserts.map((entry) => [entry.pending?.commandId, entry.pending?.order])).toEqual([["b", 1], ["a", 2]]);
    expect(mutation?.beforeCommandId).toBe("a");
    expect(mutation?.deletes).toEqual([]);
  });

  it("uses one stable row identity from optimistic send through authoritative turn", () => {
    const commandId = "android-command-42";
    const authoritative = {
      ...turn(),
      id: "remote-turn-9",
      items: [{
        id: "user-9",
        type: "userMessage",
        clientId: commandId,
        content: [{ type: "text", text: "hello", text_elements: [] }],
      }],
    } as Turn;
    expect(authoritativeTimelineRowId("server", "thread", authoritative))
      .toBe(pendingTimelineRowId("server", "thread", commandId));
  });

  it("projects pending delivery and queue entries from the thread collection only", () => {
    const delivery = {
      commandId: "delivery",
      method: "turn/start" as const,
      presentation: "delivery" as const,
      text: "send now",
      attachments: [],
      state: "accepted" as const,
      attempts: 1,
      lastError: null,
      createdAt: 20,
      updatedAt: 21,
      order: 20,
    };
    const queued = { ...delivery, commandId: "queue", presentation: "queue" as const, text: "later", createdAt: 10, order: 1 };
    expect(materializePendingTimeline([
      row({ id: "delivery", kind: "pending", remoteTurnId: null, sealed: false, pending: delivery }),
      row({ id: "queue", kind: "pending", remoteTurnId: null, sealed: false, pending: queued }),
      row({ id: "turn", kind: "turn", pending: null, turn: turn() }),
    ])).toEqual([queued, delivery]);
  });

  it("drops the local entry structurally when the same row becomes authoritative", () => {
    const id = pendingTimelineRowId("server", "thread", "command");
    const authoritative = row({ id, kind: "turn", remoteTurnId: "remote", pending: null, turn: { ...turn(), id: "remote" } });
    expect(materializePendingTimeline([authoritative])).toEqual([]);
    expect(materializeThreadTurns([authoritative]).map((entry) => entry.id)).toEqual(["remote"]);
  });

  it("removes orphan direct-delivery projections after Kotlin retires their receipts", () => {
    const pending = (commandId: string, presentation: "delivery" | "queue") => row({
      id: commandId,
      kind: "pending",
      remoteTurnId: null,
      sealed: false,
      pending: {
        commandId,
        method: "turn/start",
        presentation,
        text: commandId,
        attachments: [],
        state: "delivered",
        attempts: 1,
        lastError: null,
        createdAt: 1,
        updatedAt: 2,
        order: 1,
      },
    });

    expect(planPendingDeliveryProjectionCleanup([
      pending("still-native", "delivery"),
      pending("retired", "delivery"),
      pending("queued", "queue"),
    ], new Set(["still-native"]))).toEqual({
      upserts: [],
      deletes: ["retired"],
    });
  });

  it("does not refresh a known hot thread from a lossy active rollout summary", () => {
    expect(shouldRefreshInvalidatedThread(true, true, true)).toBe(false);
    expect(shouldRefreshInvalidatedThread(true, true, false)).toBe(true);
    expect(shouldRefreshInvalidatedThread(false, false, true)).toBe(true);
    expect(shouldRefreshInvalidatedThread(true, false, false)).toBe(false);
  });

  it("compacts completed activity without losing its collapsed index or chat boundary", () => {
    const user = { id: "user", type: "userMessage", content: [{ type: "text", text: "run" }] } as Turn["items"][number];
    const tool = { id: "tool", type: "commandExecution", command: "pnpm test", status: "completed" } as Turn["items"][number];
    const intermediate = { id: "intermediate", type: "agentMessage", text: "working" } as Turn["items"][number];
    const reasoning = { id: "reasoning", type: "reasoning", summary: ["checking"] } as Turn["items"][number];
    const final = { id: "final", type: "agentMessage", text: "done" } as Turn["items"][number];
    const compacted = compactCompletedTurnForStorage({
      ...turn(),
      itemsView: "full",
      items: [user, tool, intermediate, reasoning, final],
    } as Turn);

    expect(compacted.itemsView).toBe("summary");
    expect(compacted.items.map((item) => item.id)).toEqual(["user", "final"]);
    expect((compacted as Turn & { codewide?: { activity?: { count: number; kinds: string[] } } }).codewide?.activity).toEqual({
      count: 3,
      kinds: ["commandExecution", "agentMessage", "reasoning"],
    });
  });

  it("keeps command output footprint when completed activity is compacted", () => {
    const user = { id: "user", type: "userMessage", content: [{ type: "text", text: "run" }] } as Turn["items"][number];
    const tool = {
      id: "tool",
      type: "commandExecution",
      command: "pnpm test",
      status: "completed",
      codewideOutputFootprint: { version: 1, basis: "approxBytesPerToken", bytes: 4_000, estimatedTokens: 1_000 },
    } as unknown as Turn["items"][number];
    const final = { id: "final", type: "agentMessage", text: "done" } as Turn["items"][number];

    const compacted = compactCompletedTurnForStorage({
      ...turn(),
      itemsView: "full",
      items: [user, tool, final],
    } as Turn);

    expect((compacted as Turn & { codewide?: { activity?: { outputFootprint?: unknown } } }).codewide?.activity?.outputFootprint).toEqual({
      version: 1,
      basis: "approxBytesPerToken",
      bytes: 4_000,
      estimatedTokens: 1_000,
    });
  });

  it("never rewrites sealed content from a late live event", () => {
    const previous = row({ sealed: true, turn: turn() });
    expect(shouldApplyLiveThreadRow(previous, row({ sealed: true, turn: { ...turn(), items: [{ type: "agentMessage", text: "late" }] } as Turn }))).toBe(false);
  });

  it("keeps sealed history and hydrated activity immutable across authoritative refreshes", () => {
    expect(shouldWriteThreadDetailRow(row({ sealed: true, turn: turn() }), row({ sealed: true, turn: { ...turn(), durationMs: 99 } }))).toBe(false);
    expect(shouldWriteThreadDetailRow(
      row({ kind: "activity", activityItems: [{ type: "agentMessage", text: "cached" }] }),
      row({ kind: "activity", activityItems: [{ type: "agentMessage", text: "replacement" }] }),
    )).toBe(false);
  });

  it("replaces a stale private asset during explicit activity recovery", () => {
    const staleId = "a".repeat(64);
    const freshId = "b".repeat(64);
    const activity = (assetId: string) => row({
      kind: "activity",
      activityItems: [{
        id: "image",
        type: "image",
        codewideAsset: { version: 1, id: assetId, byteLength: 100, contentType: "image/png" },
      }] as unknown as Turn["items"],
    });

    expect(shouldWriteThreadDetailRow(activity(staleId), activity(freshId))).toBe(false);
    expect(shouldWriteHydratedActivityRow(activity(staleId), activity(freshId))).toBe(true);
    expect(shouldWriteHydratedActivityRow(activity(freshId), activity(freshId))).toBe(false);
  });

  it("repairs a sealed turn when the authoritative summary supplies its missing prompt", () => {
    const agent = { type: "agentMessage", id: "agent", text: "answer" } as Turn["items"][number];
    const user = { type: "userMessage", id: "user", clientId: "client", content: [] } as Turn["items"][number];
    const previous = row({ sealed: true, turn: { ...turn(), items: [agent] } as Turn });
    const complete = row({ sealed: true, turn: { ...turn(), items: [user, agent], itemsView: "summary" } as Turn });

    expect(shouldApplyLiveThreadRow(previous, complete)).toBe(false);
    expect(shouldWriteAuthoritativeThreadDetailRow(previous, complete)).toBe(true);
    expect(shouldWriteAuthoritativeThreadDetailRow(complete, complete)).toBe(false);
  });

  it("replaces an intermediate sealed agent boundary with the authoritative final answer", () => {
    const user = { type: "userMessage", id: "user", clientId: "client", content: [] } as Turn["items"][number];
    const intermediate = { type: "agentMessage", id: "progress", text: "Working…" } as Turn["items"][number];
    const final = { type: "agentMessage", id: "final", text: "Done" } as Turn["items"][number];
    const previous = row({ sealed: true, turn: { ...turn(), items: [user, intermediate], itemsView: "summary" } as Turn });
    const authoritative = row({ sealed: true, turn: { ...turn(), items: [user, final], itemsView: "summary" } as Turn });

    const reconciled = reconcileAuthoritativeThreadDetailRow(previous, authoritative);
    expect(reconciled.turn?.items.map((item) => item.id)).toEqual(["user", "final"]);
    expect(shouldWriteAuthoritativeThreadDetailRow(previous, reconciled)).toBe(true);
  });

  it("repairs a full sealed boundary without discarding hydrated activity", () => {
    const user = { type: "userMessage", id: "user", clientId: "client", content: [] } as Turn["items"][number];
    const tool = { type: "commandExecution", id: "tool", command: "test" } as Turn["items"][number];
    const intermediate = { type: "agentMessage", id: "progress", text: "Working…" } as Turn["items"][number];
    const final = { type: "agentMessage", id: "final", text: "Done" } as Turn["items"][number];
    const previous = row({ sealed: true, turn: { ...turn(), items: [user, tool, intermediate], itemsView: "full" } as Turn });
    const authoritative = row({ sealed: true, turn: { ...turn(), items: [user, final], itemsView: "summary" } as Turn });

    const reconciled = reconcileAuthoritativeThreadDetailRow(previous, authoritative);
    expect(reconciled.turn?.items.map((item) => item.id)).toEqual(["user", "tool", "progress", "final"]);
    expect(reconciled.turn?.itemsView).toBe("full");
  });

  it("reconciles rotated summary ids without duplicating cached user and final messages", () => {
    const cachedUser = {
      type: "userMessage",
      id: "live-user",
      clientId: "command",
      content: [{ type: "text", text: "Run", text_elements: [] }],
    } as Turn["items"][number];
    const cachedAgent = { type: "agentMessage", id: "live-agent", text: "Done", phase: "final_answer" } as Turn["items"][number];
    const historyUser = {
      type: "userMessage",
      id: "history-user",
      clientId: null,
      content: [{ type: "text", text: "Run", text_elements: [] }],
    } as Turn["items"][number];
    const historyAgent = { type: "agentMessage", id: "history-agent", text: "Done", phase: "final_answer" } as Turn["items"][number];
    const previous = row({ sealed: true, turn: { ...turn(), items: [cachedUser, cachedAgent], itemsView: "summary" } as Turn });
    const authoritative = row({ sealed: true, turn: { ...turn(), items: [historyUser, historyAgent], itemsView: "summary" } as Turn });

    const reconciled = reconcileAuthoritativeThreadDetailRow(previous, authoritative);

    expect(reconciled.turn?.items).toHaveLength(2);
    expect(reconciled.turn?.items[0]).toMatchObject({ id: "history-user", clientId: "command" });
    expect(reconciled.turn?.items[1]).toMatchObject({ id: "history-agent", text: "Done" });
  });

  it("repairs an already duplicated persisted summary", () => {
    const user = {
      type: "userMessage",
      id: "user",
      clientId: "command",
      content: [{ type: "text", text: "Run", text_elements: [] }],
    } as Turn["items"][number];
    const duplicateUser = { ...user, id: "duplicate-user", clientId: null } as Turn["items"][number];
    const final = { type: "agentMessage", id: "final", text: "Done", phase: "final_answer" } as Turn["items"][number];
    const duplicateFinal = { ...final, id: "duplicate-final" } as Turn["items"][number];
    const previous = row({
      sealed: true,
      turn: { ...turn(), items: [user, duplicateUser, duplicateFinal, final], itemsView: "summary" } as Turn,
    });
    const authoritative = row({
      sealed: true,
      turn: { ...turn(), items: [user, final], itemsView: "summary" } as Turn,
    });

    expect(shouldWriteAuthoritativeThreadDetailRow(previous, authoritative)).toBe(true);
    expect(reconcileAuthoritativeThreadDetailRow(previous, authoritative).turn?.items).toEqual([user, final]);
  });

  it("never erases a persisted final answer when a later summary is incomplete", () => {
    const user = { type: "userMessage", id: "user", clientId: "command", content: [] } as Turn["items"][number];
    const final = { type: "agentMessage", id: "final", text: "Done", phase: "final_answer" } as Turn["items"][number];
    const previous = row({
      sealed: true,
      turn: { ...turn(), items: [user, final], itemsView: "summary" } as Turn,
    });
    const incomplete = row({
      sealed: true,
      turn: { ...turn(), items: [user], itemsView: "summary" } as Turn,
    });

    const reconciled = reconcileAuthoritativeThreadDetailRow(previous, incomplete);
    expect(reconciled.turn?.items).toEqual([user, final]);
    expect(shouldWriteAuthoritativeThreadDetailRow(previous, reconciled)).toBe(false);
  });

  it("materializes one turn for repeated delivery of the same client command", () => {
    const prompt = (id: string) => ({
      type: "userMessage",
      id: `${id}-user`,
      clientId: "android-command",
      content: [{ type: "text", text: "Run", text_elements: [] }],
    }) as Turn["items"][number];
    const rows = [
      row({ id: "original-row", remoteTurnId: "original", ordinal: 1, turn: { ...turn(), id: "original", items: [prompt("original")], itemsView: "summary" } as Turn }),
      row({ id: "retry-row", remoteTurnId: "retry", ordinal: 2, turn: { ...turn(), id: "retry", items: [prompt("retry")], itemsView: "summary" } as Turn }),
    ];

    expect(materializeThreadTurns(rows).map(({ id }) => id)).toEqual(["original"]);
  });

  it("repairs sealed lifecycle metadata without replacing immutable message content", () => {
    const previousTurn = { ...turn(), durationMs: 10, items: [{ type: "agentMessage", id: "agent", text: "kept" }] } as Turn;
    const incomingTurn = { ...previousTurn, durationMs: 99, items: [{ type: "agentMessage", id: "agent", text: "stale copy" }] } as Turn;
    const previous = row({ sealed: true, turn: previousTurn });
    const reconciled = reconcileAuthoritativeThreadDetailRow(previous, row({ sealed: true, turn: incomingTurn }));

    expect(reconciled.turn?.durationMs).toBe(99);
    expect(reconciled.turn?.items).toBe(previousTurn.items);
    expect(shouldWriteAuthoritativeThreadDetailRow(previous, reconciled)).toBe(true);
  });

  it("never reopens a terminal turn from a stale authoritative response", () => {
    const previous = row({ sealed: true, turn: turn() });
    const stale = row({ sealed: false, turn: { ...turn(), status: "inProgress", completedAt: null, durationMs: null } as Turn });
    const reconciled = reconcileAuthoritativeThreadDetailRow(previous, stale);

    expect(reconciled.sealed).toBe(true);
    expect(reconciled.turn?.status).toBe("completed");
    expect(shouldWriteAuthoritativeThreadDetailRow(previous, reconciled)).toBe(false);
  });

  it("drops an abandoned mutable head unless an event arrived during the refresh", () => {
    const active = { ...turn(), id: "active", status: "inProgress", completedAt: null, durationMs: null } as Turn;
    const incoming = { id: "thread", turns: [] } as unknown as Thread;
    const current = { id: "thread", turns: [active] } as unknown as Thread;

    expect(reconcileAuthoritativeThread(incoming, current, false).turns).toEqual([]);
    expect(reconcileAuthoritativeThread(incoming, current, true).turns).toEqual([active]);
  });

  it("keeps small late metadata reactive after content is sealed", () => {
    const previous = row({ kind: "turnMeta", sealed: false });
    expect(shouldApplyLiveThreadRow(previous, row({ kind: "turnMeta", turnMetadata: { diff: "late diff" } }))).toBe(true);
  });

  it("materializes immutable content, mutable metadata, and separately hydrated activity", () => {
    const thread = {
      id: "thread",
      name: "Thread",
      preview: "preview",
      cwd: "/repo",
      updatedAt: 2,
      status,
      ephemeral: false,
      turns: [],
    } as unknown as Thread;
    const rows = [
      row({ id: "meta", kind: "thread", remoteTurnId: null, sessionId: "current", thread }),
      row({ id: "content", turn: turn(), ordinal: 4 }),
      row({ id: "metadata", kind: "turnMeta", turnMetadata: { diff: "final diff" }, ordinal: 4 }),
      row({ id: "activity", kind: "activity", activityItems: [{ type: "agentMessage", text: "full answer" }], ordinal: 0 }),
    ];

    const snapshot = materializeThreadDetails(rows, "current")[0];

    expect(snapshot?.fresh).toBe(true);
    expect(snapshot?.thread.turns[0]?.itemsView).toBe("full");
    expect(snapshot?.thread.turns[0]?.items).toEqual([{ type: "agentMessage", text: "full answer" }]);
    expect((snapshot?.thread.turns[0] as Turn & { codewide?: { diff?: string } }).codewide?.diff).toBe("final diff");
  });

  it("does not let an incomplete activity overlay hide the summary user prompt", () => {
    const thread = {
      id: "thread",
      name: "Thread",
      preview: "preview",
      cwd: "/repo",
      updatedAt: 2,
      status,
      ephemeral: false,
      turns: [],
    } as unknown as Thread;
    const user = { type: "userMessage", id: "user", clientId: "client", content: [] } as Turn["items"][number];
    const agent = { type: "agentMessage", id: "agent", text: "answer" } as Turn["items"][number];
    const rows = [
      row({ id: "meta", kind: "thread", remoteTurnId: null, sessionId: "current", thread }),
      row({ id: "content", turn: { ...turn(), items: [user, agent], itemsView: "summary" } as Turn }),
      row({ id: "activity", kind: "activity", activityItems: [agent] }),
    ];

    expect(materializeThreadDetails(rows, "current")[0]?.thread.turns[0]?.items.map((item) => item.type)).toEqual([
      "userMessage",
      "agentMessage",
    ]);
  });

  it("does not duplicate chat boundaries when hydrated activity uses different item ids", () => {
    const thread = {
      id: "thread",
      name: "Thread",
      preview: "preview",
      cwd: "/repo",
      updatedAt: 2,
      status,
      ephemeral: false,
      turns: [],
    } as unknown as Thread;
    const summaryUser = {
      type: "userMessage",
      id: "summary-user",
      clientId: "command",
      content: [{ type: "text", text: "Run", text_elements: [] }],
    } as Turn["items"][number];
    const summaryAgent = { type: "agentMessage", id: "summary-agent", text: "Done", phase: "final_answer" } as Turn["items"][number];
    const activityUser = {
      type: "userMessage",
      id: "activity-user",
      clientId: null,
      content: [{ type: "text", text: "Run", text_elements: [] }],
    } as Turn["items"][number];
    const activityAgent = { type: "agentMessage", id: "activity-agent", text: "Done", phase: "final_answer" } as Turn["items"][number];
    const rows = [
      row({ id: "meta", kind: "thread", remoteTurnId: null, sessionId: "current", thread }),
      row({ id: "content", turn: { ...turn(), items: [summaryUser, summaryAgent], itemsView: "summary" } as Turn }),
      row({ id: "activity", kind: "activity", activityItems: [activityUser, activityAgent] }),
    ];

    const items = materializeThreadDetails(rows, "current")[0]?.thread.turns[0]?.items;

    expect(items).toHaveLength(2);
    expect(items?.[0]).toMatchObject({ id: "summary-user", clientId: "command" });
    expect(items?.[1]).toMatchObject({ id: "summary-agent", text: "Done" });
  });

  it("orders retained history by immutable server time when page ordinals overlap", () => {
    const thread = {
      id: "thread",
      name: "Thread",
      preview: "preview",
      cwd: "/repo",
      updatedAt: 3,
      status,
      ephemeral: false,
      turns: [],
    } as unknown as Thread;
    const older = { ...turn(), id: "older", startedAt: 1 };
    const newer = { ...turn(), id: "newer", startedAt: 2 };
    const rows = [
      row({ id: "meta", kind: "thread", remoteTurnId: null, sessionId: "current", thread }),
      row({ id: "newer-row", remoteTurnId: "newer", turn: newer, ordinal: 0 }),
      row({ id: "older-row", remoteTurnId: "older", turn: older, ordinal: 0 }),
    ];

    expect(materializeThreadDetails(rows, "current")[0]?.thread.turns.map((entry) => entry.id)).toEqual(["older", "newer"]);
  });

  it("preserves static turn identity when only another turn changes", () => {
    const thread = {
      id: "thread",
      name: "Thread",
      preview: "preview",
      cwd: "/repo",
      updatedAt: 3,
      status,
      ephemeral: false,
      turns: [],
    } as unknown as Thread;
    const completed = { ...turn(), id: "completed" };
    const active = { ...turn(), id: "active", status: "inProgress" } as Turn;
    const rows = [
      row({ id: "meta", kind: "thread", remoteTurnId: null, sessionId: "current", thread }),
      row({ id: "completed-row", remoteTurnId: "completed", turn: completed, ordinal: 0 }),
      row({ id: "active-row", remoteTurnId: "active", turn: active, ordinal: 1, sealed: false }),
    ];

    const first = materializeThreadDetails(rows, "current")[0]!.thread.turns;
    const second = materializeThreadDetails([
      rows[0]!,
      rows[1]!,
      row({
        id: "active-row",
        remoteTurnId: "active",
        turn: { ...active, items: [{ type: "agentMessage", text: "delta" }] } as Turn,
        ordinal: 1,
        sealed: false,
      }),
    ], "current")[0]!.thread.turns;

    expect(second[0]).toBe(first[0]);
    expect(second[1]).not.toBe(first[1]);
  });

  it("materializes a sealed history partition independently from the live head", () => {
    const sealed = { ...turn(), id: "sealed" };
    const active = { ...turn(), id: "active", status: "inProgress" } as Turn;
    const sealedRows = [
      row({ id: "sealed-content", remoteTurnId: "sealed", turn: sealed, ordinal: 0, sealed: true }),
      row({ id: "sealed-meta", kind: "turnMeta", remoteTurnId: "sealed", turnMetadata: { diff: "stable" }, ordinal: 0, sealed: true }),
    ];

    const first = materializeThreadTurns(sealedRows);
    const second = materializeThreadTurns(sealedRows);
    const live = materializeThreadTurns([
      row({ id: "active-content", remoteTurnId: "active", turn: active, ordinal: 1, sealed: false }),
    ]);

    expect(first[0]).toBe(second[0]);
    expect(first.map((entry) => entry.id)).toEqual(["sealed"]);
    expect(live.map((entry) => entry.id)).toEqual(["active"]);
  });

  it("reuses a materialized turn while activity and metadata overlays are unchanged", () => {
    const thread = {
      id: "thread",
      name: "Thread",
      preview: "preview",
      cwd: "/repo",
      updatedAt: 3,
      status,
      ephemeral: false,
      turns: [],
    } as unknown as Thread;
    const content = turn();
    const metadata = { diff: "stable diff" };
    const activity = [{ type: "agentMessage", text: "full answer" }] as Turn["items"];
    const rows = [
      row({ id: "meta", kind: "thread", remoteTurnId: null, sessionId: "current", thread }),
      row({ id: "content", turn: content }),
      row({ id: "metadata", kind: "turnMeta", turnMetadata: metadata }),
      row({ id: "activity", kind: "activity", activityItems: activity }),
    ];

    const first = materializeThreadDetails(rows, "current")[0]!.thread.turns[0];
    const second = materializeThreadDetails([...rows], "current")[0]!.thread.turns[0];

    expect(second).toBe(first);
  });

  it("reduces live events against the mutable head instead of the full sealed history", () => {
    const thread = {
      id: "thread",
      name: "Thread",
      preview: "preview",
      cwd: "/repo",
      updatedAt: 3,
      status,
      ephemeral: false,
      turns: [],
    } as unknown as Thread;
    const rows = [
      row({ id: "meta", kind: "thread", remoteTurnId: null, thread }),
      row({ id: "old-content", remoteTurnId: "old", turn: { ...turn(), id: "old" }, sealed: true }),
      row({ id: "old-metadata", kind: "turnMeta", remoteTurnId: "old", turnMetadata: { diff: "old" } }),
      row({ id: "active-content", remoteTurnId: "active", turn: { ...turn(), id: "active", status: "inProgress" } as Turn, sealed: false }),
      row({ id: "active-metadata", kind: "turnMeta", remoteTurnId: "active", turnMetadata: { diff: "live" } }),
    ];

    const selected = selectLiveThreadDetailRows(rows, "server", "thread", [{
      method: "item/agentMessage/delta",
      params: { threadId: "thread", turnId: "active", itemId: "agent", delta: "x" },
    }]);

    expect(selected.map((entry) => entry.id)).toEqual(["meta", "active-content", "active-metadata"]);
  });

  it("includes an explicitly addressed sealed turn only for its late metadata overlay", () => {
    const thread = {
      id: "thread",
      name: "Thread",
      preview: "preview",
      cwd: "/repo",
      updatedAt: 3,
      status,
      ephemeral: false,
      turns: [],
    } as unknown as Thread;
    const rows = [
      row({ id: "meta", kind: "thread", remoteTurnId: null, thread }),
      row({ id: "old-content", remoteTurnId: "old", turn: { ...turn(), id: "old" }, sealed: true }),
      row({ id: "other-content", remoteTurnId: "other", turn: { ...turn(), id: "other" }, sealed: true }),
    ];

    const selected = selectLiveThreadDetailRows(rows, "server", "thread", [{
      method: "thread/tokenUsage/updated",
      params: { threadId: "thread", turnId: "old", tokenUsage: {} },
    }]);

    expect(selected.map((entry) => entry.id)).toEqual(["meta", "old-content"]);
  });
});
