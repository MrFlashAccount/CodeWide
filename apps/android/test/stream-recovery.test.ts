import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import type { SyncEvent } from "@codewide/sync-client";
import { describe, expect, it } from "vitest";

import { streamRepairThreadIds, terminalProjectionMatches, terminalProjectionProofs } from "../src/data/stream-recovery";

describe("stream recovery", () => {
  it("requires an authoritative repair when a middle item event was lost", () => {
    const value = thread();
    const events = [syncEvent("item/agentMessage/delta", {
      turnId: "turn",
      itemId: "missing-agent-item",
      delta: "lost prefix",
    }, {
      kind: "itemTextDelta",
      turnId: "turn",
      itemId: "missing-agent-item",
      itemType: "agentMessage",
      delta: "lost prefix",
    })];

    expect(streamRepairThreadIds(events, new Map([["thread", { before: value, after: value }]]))).toEqual(["thread"]);
  });

  it("does not repair an ordinary contiguous delta batch", () => {
    const value = thread();
    const events = [syncEvent("item/agentMessage/delta", {
      turnId: "turn",
      itemId: "agent",
      delta: " world",
    }, {
      kind: "itemTextDelta",
      turnId: "turn",
      itemId: "agent",
      itemType: "agentMessage",
      delta: " world",
    })];

    const after = structuredClone(value);
    (after.turns[0]!.items[0] as Extract<Thread["turns"][number]["items"][number], { type: "agentMessage" }>).text = "hello world";
    expect(streamRepairThreadIds(events, new Map([["thread", { before: value, after }]]))).toEqual([]);
  });

  it("finalizes an already-loaded turn from the ordered journal without a server read", () => {
    const value = thread();
    const completed = { ...value.turns[0]!, status: "completed", completedAt: 2 };
    const events = [syncEvent("turn/completed", { turn: completed }, {
      kind: "turnCompleted",
      turn: completed,
    })];

    const after = structuredClone(value);
    after.turns[0] = completed;
    expect(streamRepairThreadIds(events, new Map([["thread", { before: value, after }]]))).toEqual([]);
  });

  it("repairs a cold sparse terminal event that cannot reconstruct its turn", () => {
    const value = thread();
    value.turns = [];
    const completed = { ...thread().turns[0]!, items: [], status: "completed" as const, completedAt: 2 };
    const events = [syncEvent("turn/completed", { turn: completed }, {
      kind: "turnCompleted",
      turn: completed,
    })];

    expect(streamRepairThreadIds(events, new Map([["thread", { before: value, after: value }]]))).toEqual(["thread"]);
  });

  it("repairs a completed turn before ACK when its final text is missing", () => {
    const value = thread();
    value.turns[0]!.items = [];
    const completed = { ...value.turns[0]!, status: "completed" as const, completedAt: 2 };
    const events = [syncEvent("turn/completed", { turn: completed }, {
      kind: "turnCompleted",
      turn: completed,
    })];
    const after = structuredClone(value);
    after.turns[0] = completed;

    expect(streamRepairThreadIds(events, new Map([["thread", { before: value, after }]]))).toEqual(["thread"]);
  });

  it("verifies the authoritative terminal text against the companion hash", () => {
    const value = thread();
    value.turns[0]!.status = "completed";
    value.turns[0]!.completedAt = 2;
    const events = [syncEvent("turn/completed", { turn: value.turns[0] }, {
      kind: "turnCompleted",
      turn: value.turns[0],
      terminalProjection: {
        version: 1,
        turnId: "turn",
        agentMessage: {
          utf8Bytes: 5,
          sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        },
      },
    })];

    const [proof] = terminalProjectionProofs(events);
    expect(proof).toBeDefined();
    expect(terminalProjectionMatches(value, proof!)).toBe(true);
    (value.turns[0]!.items[0] as Extract<Thread["turns"][number]["items"][number], { type: "agentMessage" }>).text = "truncated";
    expect(terminalProjectionMatches(value, proof!)).toBe(false);
  });

  it("verifies only the newest completed turn from a replay batch", () => {
    const older = syncEvent("turn/completed", {}, {
      kind: "turnCompleted",
      terminalProjection: {
        version: 1,
        turnId: "older-turn-outside-the-window",
        agentMessage: null,
      },
    });
    const newest = syncEvent("turn/completed", {}, {
      kind: "turnCompleted",
      terminalProjection: {
        version: 1,
        turnId: "newest-turn-in-the-window",
        agentMessage: {
          utf8Bytes: 5,
          sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        },
      },
    });

    expect(terminalProjectionProofs([older, newest])).toEqual([{
      threadId: "thread",
      turnId: "newest-turn-in-the-window",
      agentMessage: {
        utf8Bytes: 5,
        sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      },
    }]);
  });

  it("does not treat a legacy null witness as proof that the turn has no agent message", () => {
    const events = [syncEvent("turn/completed", {}, {
      kind: "turnCompleted",
      terminalProjection: {
        version: 1,
        turnId: "interrupted-turn",
        agentMessage: null,
      },
    })];

    expect(terminalProjectionProofs(events)).toEqual([]);
  });

  it("lets an unwitnessed newer completion supersede an older replay witness", () => {
    const older = syncEvent("turn/completed", {}, {
      kind: "turnCompleted",
      terminalProjection: {
        version: 1,
        turnId: "older-turn",
        agentMessage: {
          utf8Bytes: 5,
          sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        },
      },
    });
    const newest = syncEvent("turn/completed", {}, {
      kind: "turnCompleted",
      terminalProjection: {
        version: 1,
        turnId: "interrupted-turn",
        agentMessage: null,
      },
    });

    expect(terminalProjectionProofs([older, newest])).toEqual([]);
  });
});

function syncEvent(method: string, params: Record<string, unknown>, operation: Record<string, unknown>): SyncEvent {
  return {
    cursor: 1,
    payload: {
      method,
      params: { threadId: "thread", ...params },
      codewideThreadPatch: { version: 1, threadId: "thread", operation },
    },
  };
}

function thread(): Thread {
  return {
    id: "thread",
    extra: null,
    sessionId: "thread",
    forkedFromId: null,
    parentThreadId: null,
    preview: "preview",
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    historyMode: "paginated",
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 1,
    recencyAt: 1,
    status: { type: "active", activeFlags: [] },
    path: null,
    cwd: "/workspace",
    cliVersion: "0.147.0",
    source: "appServer",
    canAcceptDirectInput: true,
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: "Thread",
    turns: [{
      id: "turn",
      itemsView: "full",
      status: "inProgress",
      error: null,
      startedAt: 1,
      completedAt: null,
      durationMs: null,
      items: [{
        type: "agentMessage",
        id: "agent",
        text: "hello",
        phase: null,
        memoryCitation: null,
      }],
    }],
  };
}
