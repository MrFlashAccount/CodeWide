import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { describe, expect, it } from "vitest";

import {
  projectResidentThreadTimeline,
  protocolTimestampMs,
  type ProjectedThreadChatDelivery,
} from "../src/data/thread-chat-timeline";
import { applyThreadSummaryMetadata } from "../src/data/thread-metadata-projection";
import type { StoredThreadSummary } from "../src/data/thread-summary-types";

type Turn = Thread["turns"][number];

function turn(id: string, startedAt: number, clientId?: string): Turn {
  return {
    id,
    startedAt,
    items: clientId === undefined ? [] : [{ type: "userMessage", clientId, content: [] }],
  } as unknown as Turn;
}

function delivery(commandId: string, createdAt: number): ProjectedThreadChatDelivery {
  return {
    connectionId: "server",
    commandId,
    method: "turn/start",
    threadId: "thread",
    targetCommandId: null,
    text: commandId,
    attachments: [],
    state: "failed",
    attempts: 1,
    lastError: "offline",
    createdAt,
    updatedAt: createdAt,
  };
}

describe("thread chat timeline projection", () => {
  it("orders delivery rows at their creation time inside the resident flow", () => {
    const timeline = projectResidentThreadTimeline(
      [turn("before", 1), turn("after", 3)],
      [delivery("local", 2_000)],
      { includesEarliest: true, includesLatest: true },
    );

    expect(timeline.map((entry) => entry.kind === "turn" ? entry.turn.id : entry.delivery.commandId))
      .toEqual(["before", "local", "after"]);
  });

  it("does not inject an old failed delivery into an unrelated resident tail", () => {
    const timeline = projectResidentThreadTimeline(
      [turn("tail-1", 10), turn("tail-2", 11)],
      [delivery("old-failure", 2_000), delivery("new-failure", 12_000)],
      { includesEarliest: false, includesLatest: true },
    );

    expect(timeline.map((entry) => entry.kind === "turn" ? entry.turn.id : entry.delivery.commandId))
      .toEqual(["tail-1", "tail-2", "new-failure"]);
  });

  it("lets the authoritative turn replace the matching client-id delivery", () => {
    const timeline = projectResidentThreadTimeline(
      [turn("authoritative", 2, "client-42")],
      [delivery("client-42", 2_000)],
      { includesEarliest: true, includesLatest: true },
    );

    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({ kind: "turn", turn: { id: "authoritative" } });
  });

  it("normalizes protocol seconds without changing millisecond timestamps", () => {
    expect(protocolTimestampMs(1_786_647_000)).toBe(1_786_647_000_000);
    expect(protocolTimestampMs(1_786_647_000_123)).toBe(1_786_647_000_123);
    expect(protocolTimestampMs(null)).toBeNull();
  });
});

describe("thread chat metadata projection", () => {
  it("updates mutable metadata without replacing sealed turn content", () => {
    const turns = [{ id: "turn", status: "completed", items: [{ type: "agentMessage", text: "immutable" }] }];
    const thread = {
      id: "thread",
      name: "Old name",
      preview: "Old preview",
      cwd: "/old",
      updatedAt: 1,
      recencyAt: 1,
      status: { type: "idle" },
      parentThreadId: null,
      agentNickname: null,
      agentRole: null,
      turns,
    } as unknown as Thread;
    const summary = {
      connectionId: "server",
      remoteThreadId: "thread",
      name: "Renamed",
      preview: "Fresh preview",
      cwd: "/new",
      updatedAt: 5,
      recencyAt: 6,
      status: { type: "active", activeFlags: [] },
      parentThreadId: "parent",
      agentNickname: "worker",
      agentRole: "explorer",
    } as StoredThreadSummary;

    const result = applyThreadSummaryMetadata(thread, summary);

    expect(result).toMatchObject({
      name: "Renamed",
      preview: "Fresh preview",
      cwd: "/new",
      updatedAt: 5,
      recencyAt: 6,
      status: { type: "active" },
      parentThreadId: "parent",
      agentNickname: "worker",
      agentRole: "explorer",
    });
    expect(result.turns).toBe(thread.turns);
    expect(applyThreadSummaryMetadata(thread, summary)).toBe(result);
    expect(applyThreadSummaryMetadata(thread, { ...summary })).toBe(result);
  });

  it("does not apply metadata from another thread", () => {
    const thread = { id: "thread", turns: [] } as unknown as Thread;
    const summary = { remoteThreadId: "other" } as StoredThreadSummary;

    expect(applyThreadSummaryMetadata(thread, summary)).toBe(thread);
  });
});
