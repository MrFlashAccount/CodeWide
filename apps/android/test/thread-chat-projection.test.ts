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

function canonicalTextTurn(id: string, text: string, startedAt: number, clientId: string | null = null): Turn {
  return {
    ...turn(id, startedAt),
    status: "inProgress",
    items: [{
      type: "userMessage",
      id: `${id}-user`,
      clientId,
      content: [{ type: "text", text, text_elements: [] }],
    }],
  } as unknown as Turn;
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

  it("does not discard a delivery based only on matching legacy canonical text", () => {
    const timeline = projectResidentThreadTimeline(
      [canonicalTextTurn("authoritative", "Test", 2)],
      [{ ...delivery("client-42", 2_000), text: "Test", state: "appServerAccepted", lastError: null }],
      { includesEarliest: true, includesLatest: true },
    );

    expect(timeline).toHaveLength(2);
    expect(timeline).toContainEqual(expect.objectContaining({ kind: "turn" }));
    expect(timeline).toContainEqual(expect.objectContaining({
      kind: "delivery",
      delivery: expect.objectContaining({ commandId: "client-42" }),
    }));
  });

  it("normalizes protocol seconds without changing millisecond timestamps", () => {
    expect(protocolTimestampMs(1_786_647_000)).toBe(1_786_647_000_000);
    expect(protocolTimestampMs(1_786_647_000_123)).toBe(1_786_647_000_123);
    expect(protocolTimestampMs(null)).toBeNull();
  });

  it("hides Codex environment context without hiding the agent response in the same turn", () => {
    const contextualTurn = {
      ...turn("contextual", 2),
      status: "completed",
      items: [
        {
          type: "userMessage",
          id: "context",
          clientId: null,
          content: [{
            type: "text",
            text: "  <ENVIRONMENT_CONTEXT>\n  <cwd>/tmp</cwd>\n</environment_context>  ",
            text_elements: [],
          }],
        },
        { type: "agentMessage", id: "answer", text: "Done", phase: "final_answer", memoryCitation: null },
      ],
    } as unknown as Turn;

    const timeline = projectResidentThreadTimeline(
      [contextualTurn],
      [],
      { includesEarliest: true, includesLatest: true },
    );

    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      kind: "turn",
      turn: { items: [{ type: "agentMessage", text: "Done" }] },
    });
    expect(contextualTurn.items).toHaveLength(2);
  });

  it("omits a completed turn that contains only Codex environment context", () => {
    const contextualTurn = {
      ...turn("context-only", 2),
      status: "completed",
      items: [{
        type: "userMessage",
        id: "context",
        clientId: null,
        content: [{
          type: "text",
          text: "<environment_context>\n  <cwd>/tmp</cwd>\n</environment_context>",
          text_elements: [],
        }],
      }],
    } as unknown as Turn;

    expect(projectResidentThreadTimeline(
      [contextualTurn],
      [],
      { includesEarliest: true, includesLatest: true },
    )).toEqual([]);
  });

  it("keeps authored text that quotes or discusses an environment context block", () => {
    const quoted = {
      ...turn("quoted", 2),
      status: "completed",
      items: [{
        type: "userMessage",
        id: "quoted-message",
        clientId: null,
        content: [{
          type: "text",
          text: "'''<environment_context>internal</environment_context>''' вот такая штука видна",
          text_elements: [],
        }],
      }],
    } as unknown as Turn;

    expect(projectResidentThreadTimeline(
      [quoted],
      [],
      { includesEarliest: true, includesLatest: true },
    )[0]).toMatchObject({ kind: "turn", turn: { id: "quoted" } });
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
      status: { type: "idle" },
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
