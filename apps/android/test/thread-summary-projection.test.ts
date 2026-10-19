import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import { describe, expect, it } from "vitest";

import type { StoredThreadSummary } from "../src/data/thread-summary-types";
import {
  projectThreadSummaryEvent,
  projectThreadSummarySnapshot,
  retainThreadSummaryMissingFromSnapshot,
  threadSummaryDescendantKeys,
  threadSummaryEventAffectsDevice,
  threadSummaryKey,
} from "../src/data/thread-summary-projection";

const status = { type: "idle" } as const;

function summary(preview = "Latest cached answer"): StoredThreadSummary {
  return {
    connectionId: "server",
    remoteThreadId: "thread",
    name: "Thread",
    preview,
    cwd: "/repo",
    updatedAt: 10,
    recencyAt: 10,
    status,
    pinned: true,
    archived: false,
    pendingRequestCount: 0,
    latestActivityCursor: 0,
    lastSeenCursor: 0,
    unread: 0,
    provisionalThread: null,
    deleteCommandId: null,
  };
}

function thread(turns: unknown[] = []): Thread {
  return {
    id: "thread",
    name: "Thread",
    preview: "First prompt",
    cwd: "/repo",
    updatedAt: 20,
    recencyAt: 20,
    status,
    ephemeral: false,
    turns,
  } as unknown as Thread;
}

const SERVER_FIELDS = [
  "archived",
  "name",
  "pinCursor",
  "pinned",
  "preview",
  "provisionalThread",
  "recencyAt",
  "status",
  "updatedAt",
] as const;

function serverFields(row: StoredThreadSummary | null | undefined): Record<string, unknown> {
  return Object.fromEntries(SERVER_FIELDS.map((field) => [field, row?.[field]]));
}

describe("thread summary event projection", () => {
  it.each([
    { kind: "turnStarted", summary: { activity: true, previewText: "New prompt", recencyAt: 41 } },
    { kind: "turnCompleted", summary: { activity: true, finalAgentResponse: true, previewText: "Done" } },
    { kind: "itemUpsert", summary: { activity: true, previewText: "Stream complete" } },
    { kind: "threadInvalidated", turnActive: false, summary: { activity: true, previewText: "External" } },
    { kind: "threadStatus", status: { type: "active", activeFlags: [] } },
    { kind: "threadName", threadName: "Renamed" },
    { kind: "threadArchived", archived: true },
    { kind: "threadPinned", pinned: false, pinCursor: 99 },
  ])("leaves every server field of the row to Companion list rows ($kind)", (operation) => {
    const current = { ...summary(), pinCursor: 3 };
    const mutation = projectThreadSummaryEvent("server", semanticEvent(operation), () => current, 7);

    expect(serverFields(mutation?.value ?? current)).toEqual(serverFields(current));
  });

  it("marks only the final agent answer of a completed turn unread and moves the activity cursor", () => {
    const current = summary();
    const streaming = projectThreadSummaryEvent("server", semanticEvent({
      kind: "itemUpsert",
      summary: { activity: true, previewText: "Partial" },
    }), () => current, 7)?.value;
    expect(streaming).toMatchObject({ latestActivityCursor: 7, projectionCursor: 7, unread: 0 });

    const completed = projectThreadSummaryEvent("server", semanticEvent({
      kind: "turnCompleted",
      summary: { activity: true, conversationMessage: true, finalAgentResponse: true },
      turn: { id: "answered" },
    }), () => streaming ?? undefined, 8)?.value;
    expect(completed).toMatchObject({
      firstUnreadAgentTurnId: "answered",
      lastSeenCursor: 0,
      latestActivityCursor: 8,
      unread: 1,
    });
  });

  it("retains the first unread completed turn while later turns complete or start", () => {
    const first = projectThreadSummaryEvent(
      "server",
      semanticEvent({
        kind: "turnCompleted",
        summary: { activity: true, finalAgentResponse: true },
        turn: { id: "first-unread" },
      }),
      () => summary(),
      8,
    )?.value;
    const second = projectThreadSummaryEvent(
      "server",
      semanticEvent({
        kind: "turnCompleted",
        summary: { activity: true, finalAgentResponse: true },
        turn: { id: "second-unread" },
      }),
      () => first ?? undefined,
      9,
    )?.value;
    const streaming = projectThreadSummaryEvent(
      "server",
      semanticEvent({
        kind: "turnStarted",
        summary: { activity: true, finalAgentResponse: false },
        turn: { id: "streaming" },
      }),
      () => second ?? undefined,
      10,
    )?.value;

    expect(first).toMatchObject({ firstUnreadAgentTurnId: "first-unread", unread: 1 });
    expect(second).toMatchObject({ firstUnreadAgentTurnId: "first-unread", unread: 1 });
    expect(streaming).toMatchObject({ firstUnreadAgentTurnId: "first-unread", unread: 1 });
  });

  it("does not replay an event the row already applied", () => {
    const current = { ...summary(), projectionCursor: 9 };
    expect(projectThreadSummaryEvent("server", semanticEvent({
      kind: "turnCompleted",
      summary: { activity: true, finalAgentResponse: true },
    }), () => current, 9)).toBeNull();
  });

  it.each(["tokenUsage", "itemTextDelta", "reasoningDelta", "threadProgress", "turnPlan"])(
    "ignores the interest-only %s patch",
    (kind) => {
      const current = { ...summary(), latestActivityCursor: 9, lastSeenCursor: 9 };
      expect(projectThreadSummaryEvent("server", semanticEvent({
        kind,
        summary: { activity: true },
      }), () => current, 10)).toBeNull();
    },
  );

  it("deletes only the addressed summary", () => {
    expect(projectThreadSummaryEvent("server", semanticEvent({ kind: "threadDeleted" }), () => summary()))
      .toEqual({ key: threadSummaryKey("server", "thread"), value: null });
  });

  it("starts a provisional shell and keeps it through the first turn", () => {
    const started = projectThreadSummaryEvent("server", semanticEvent({
      kind: "threadStarted",
      thread: thread(),
    }), () => undefined)?.value;
    expect(started).not.toBeNull();
    expect(retainThreadSummaryMissingFromSnapshot(started as StoredThreadSummary)).toBe(true);

    const active = projectThreadSummaryEvent("server", semanticEvent({
      kind: "turnStarted",
      summary: { activity: true },
    }), () => started ?? undefined, 1)?.value;
    expect(active?.provisionalThread).toEqual(thread());
  });

  it("adds the shell to a row a list push created first without touching its server fields", () => {
    const listed = { ...summary(), updatedAt: 20 };
    const started = projectThreadSummaryEvent("server", semanticEvent({
      kind: "threadStarted",
      thread: thread(),
    }), () => listed)?.value;

    expect(started).toMatchObject({ ...listed, provisionalThread: thread() });
  });

  it("holds only device-relevant events of a thread without a row", () => {
    expect(threadSummaryEventAffectsDevice(semanticEvent({ kind: "turnCompleted" }))).toBe(true);
    expect(threadSummaryEventAffectsDevice(semanticEvent({ kind: "itemUpsert" }))).toBe(true);
    expect(threadSummaryEventAffectsDevice(semanticEvent({
      kind: "threadInvalidated",
      summary: { activity: true },
    }))).toBe(true);
    expect(threadSummaryEventAffectsDevice(semanticEvent({ kind: "threadName" }))).toBe(false);
    expect(threadSummaryEventAffectsDevice(semanticEvent({
      kind: "threadProgress",
      summary: { activity: true },
    }))).toBe(false);
    expect(threadSummaryEventAffectsDevice({ method: "thread/started", params: {} })).toBe(false);
  });
});

describe("thread summary snapshot projection", () => {
  it("scopes subagent catalog replacement to one recursive descendant tree", () => {
    const rows = [
      { ...summary(), remoteThreadId: "root" },
      { ...summary(), remoteThreadId: "child", parentThreadId: "root" },
      { ...summary(), remoteThreadId: "grandchild", parentThreadId: "child" },
      { ...summary(), remoteThreadId: "other-child", parentThreadId: "other-root" },
    ];

    expect([...threadSummaryDescendantKeys(rows, "root")]).toEqual([
      threadSummaryKey("server", "child"),
      threadSummaryKey("server", "grandchild"),
    ]);
  });

  it("does not regress the latest preview from a metadata-only snapshot", () => {
    const result = projectThreadSummarySnapshot("server", { ...thread(), preview: "" }, false, summary());

    expect(result.preview).toBe("Latest cached answer");
    expect(result.pinned).toBe(false);
  });

  it("uses the companion-projected list preview over a stale local preview", () => {
    const listed = { ...thread(), preview: "**Newest canonical answer**" } as Thread;

    expect(projectThreadSummarySnapshot("server", listed, false, summary("First prompt")).preview)
      .toBe("Newest canonical answer");
  });

  it("clears an empty thread-start shell once the companion lists the materialized thread", () => {
    const provisional = thread();
    const previous = { ...summary("Latest answer"), provisionalThread: provisional };

    expect(projectThreadSummarySnapshot("server", thread(), false, previous).provisionalThread).toBeNull();
  });

  it("uses the latest message from an authoritative detailed snapshot", () => {
    const result = projectThreadSummarySnapshot("server", thread([
      { id: "turn", items: [{ type: "agentMessage", text: "Fresh answer" }] },
    ]), false, summary());

    expect(result.preview).toBe("Fresh answer");
  });

  it("skips a metadata-only recovery turn when projecting the Conversation preview", () => {
    const result = projectThreadSummarySnapshot("server", thread([
      { id: "complete", items: [{ type: "agentMessage", text: "Last complete answer" }] },
      { id: "metadata-only", status: "completed" },
    ]), false, summary());

    expect(result.preview).toBe("Last complete answer");
  });

  it("does not project an inherited parent prompt as a subagent preview", () => {
    const child = {
      ...thread([
        { id: "parent-turn", startedAt: 19, items: [{ type: "userMessage", content: [{ type: "text", text: "Parent chat" }] }] },
        { id: "child-turn", startedAt: 21, items: [{ type: "agentMessage", text: "Child result" }] },
      ]),
      id: "child",
      parentThreadId: "root",
      createdAt: 20,
    } as Thread;

    expect(projectThreadSummarySnapshot("server", child, false, summary("Stale parent preview")).preview).toBe("Child result");
  });

  it("previews a subagent thread from its own turns as any thread", () => {
    // The provider adapter serves only the agent's own turns.
    const child = {
      ...thread([{ id: "child-turn", startedAt: 20, items: [{ type: "userMessage", content: [{ type: "text", text: "Audit the parser" }] }] }]),
      id: "child",
      parentThreadId: "root",
      createdAt: 20,
      preview: "",
    } as Thread;

    expect(projectThreadSummarySnapshot("server", child, false, summary("Stale preview")).preview).toBe("Audit the parser");
  });

  it("keeps an event-derived child preview across a metadata-only refresh", () => {
    const child = {
      ...thread([]),
      id: "child",
      parentThreadId: "root",
      createdAt: 20,
      preview: "",
    } as Thread;
    const previous = { ...summary("Child result"), latestActivityCursor: 4 };

    expect(projectThreadSummarySnapshot("server", child, false, previous).preview).toBe("Child result");
  });

  it("keeps a scoped subagent row when the global source-kind snapshot omits it", () => {
    expect(retainThreadSummaryMissingFromSnapshot({
      ...summary(),
      parentThreadId: "root-thread",
    })).toBe(true);
  });
});

function semanticEvent(operation: Record<string, unknown>): Record<string, unknown> {
  return {
    method: "test/semantic-event",
    params: { threadId: "thread" },
    codewideThreadPatch: { version: 1, threadId: "thread", operation },
  };
}

describe("Companion-owned thread pins", () => {
  it("ignores retired local pins and reads the server pin", () => {
    expect(projectThreadSummarySnapshot("server", thread(), false, summary()).pinned).toBe(false);
    const pinned = { ...thread(), codewide: { threadPin: { version: 1, cursor: 8, pinned: true } } };
    expect(projectThreadSummarySnapshot("server", pinned, false, summary())).toMatchObject({ pinned: true, pinCursor: 8 });
  });

  it("keeps a newer server pin through a stale snapshot", () => {
    const previous = { ...summary(), pinCursor: 9, pinned: true };
    expect(projectThreadSummarySnapshot("server", thread(), false, previous).pinned).toBe(true);
  });
});
