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

    expect(streamRepairThreadIds("server", events, () => value)).toEqual(["thread"]);
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

    expect(streamRepairThreadIds("server", events, () => value)).toEqual([]);
  });

  it("always reconciles a terminal turn before projection ACK", () => {
    const value = thread();
    const completed = { ...value.turns[0]!, status: "completed", completedAt: 2 };
    const events = [syncEvent("turn/completed", { turn: completed }, {
      kind: "turnCompleted",
      turn: completed,
    })];

    expect(streamRepairThreadIds("server", events, () => value)).toEqual(["thread"]);
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
