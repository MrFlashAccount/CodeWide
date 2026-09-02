import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { describe, expect, it } from "vitest";

import type { StoredThreadSummary } from "../src/data/thread-summary-types";
import {
  projectThreadSummaryEvent,
  projectThreadSummarySnapshot,
  retainThreadSummaryMissingFromSnapshot,
  threadSummaryDescendantKeys,
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

describe("thread summary projection", () => {
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

  it("applies a companion rollout invalidation without knowing the raw App Server event", () => {
    const current = summary("Stale answer");
    const mutation = projectThreadSummaryEvent("server", {
      method: "companion/thread/invalidated",
      params: { threadId: "thread", archived: false },
      codewideThreadPatch: {
        version: 1,
        threadId: "thread",
        operation: {
          kind: "threadInvalidated",
          summary: {
            activity: true,
            conversationMessage: true,
            finalAgentResponse: false,
            previewText: "Fresh external answer",
          },
        },
      },
    }, () => current, 42, 8);

    expect(mutation?.value).toMatchObject({
      preview: "Fresh external answer",
      updatedAt: 42,
      recencyAt: 42,
      latestActivityCursor: 8,
      unread: 0,
    });
  });

  it("uses companion summary semantics instead of reinterpreting the raw method", () => {
    const current = summary();
    const mutation = projectThreadSummaryEvent("server", {
      method: "unknown/new-server-method",
      params: { threadId: "thread" },
      codewideThreadPatch: {
        version: 1,
        threadId: "thread",
        operation: {
          kind: "turnCompleted",
          summary: {
            activity: true,
            conversationMessage: true,
            finalAgentResponse: true,
            previewText: "**Canonical answer**",
          },
        },
      },
    }, () => current, 42, 8);

    expect(mutation?.value).toMatchObject({
      preview: "Canonical answer",
      updatedAt: 42,
      recencyAt: 42,
      latestActivityCursor: 8,
      unread: 1,
    });
  });
  it("does not regress the latest preview from a metadata-only snapshot", () => {
    const result = projectThreadSummarySnapshot("server", { ...thread(), preview: "" }, false, summary());

    expect(result.preview).toBe("Latest cached answer");
    expect(result.pinned).toBe(true);
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

  it("clears a stale inherited subagent preview when no child message exists", () => {
    const child = {
      ...thread([{ id: "parent-turn", startedAt: 19, items: [{ type: "userMessage", content: [{ type: "text", text: "Parent chat" }] }] }]),
      id: "child",
      parentThreadId: "root",
      createdAt: 20,
      preview: "",
    } as Thread;

    expect(projectThreadSummarySnapshot("server", child, false, summary("Stale parent preview")).preview).toBe("");
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

  it("updates the preview for item deltas without reordering Recent or marking streaming text unread", () => {
    const current = summary();
    const mutation = projectThreadSummaryEvent("server", semanticEvent({
      kind: "itemUpsert",
      summary: { activity: true, previewText: "Stream complete" },
    }), (threadId) => threadId === "thread" ? current : undefined, 42, 7);

    expect(mutation).toEqual({
      key: threadSummaryKey("server", "thread"),
      value: { ...current, preview: "Stream complete", updatedAt: 42, latestActivityCursor: 7, unread: 0 },
    });
  });

  it("does not serialize thread-list storage for token-level live patches", () => {
    const current = summary("Existing preview");

    expect(projectThreadSummaryEvent("server", {
      method: "item/agentMessage/delta",
      params: { threadId: "thread", turnId: "turn", itemId: "agent", delta: "next" },
      codewideThreadPatch: {
        version: 1,
        threadId: "thread",
        operation: {
          kind: "itemTextDelta",
          itemType: "agentMessage",
          summary: { activity: true },
        },
      },
    }, () => current, 42, 7)).toBeNull();

    expect(projectThreadSummaryEvent("server", semanticEvent({
      kind: "reasoningDelta",
      field: "summary",
      summary: { activity: true },
    }), () => current, 42, 8)).toBeNull();
  });

  it("keeps the progress preview until a phased final answer completes its turn", () => {
    const current = summary("Still working");
    const streamingFinal = projectThreadSummaryEvent("server", semanticEvent({
      kind: "itemUpsert",
      summary: { activity: true },
    }), () => current, 42, 7);

    expect(streamingFinal?.value?.preview).toBe("Still working");

    const completed = projectThreadSummaryEvent("server", semanticEvent({
      kind: "turnCompleted",
      summary: {
        activity: true,
        conversationMessage: true,
        finalAgentResponse: true,
        previewText: "Final answer",
      },
    }), () => streamingFinal?.value ?? current, 43, 8);

    expect(completed?.value?.preview).toBe("Final answer");
  });

  it("does not reorder Recent for tool activity", () => {
    const current = summary();
    const mutation = projectThreadSummaryEvent("server", semanticEvent({
      kind: "itemUpsert",
      summary: { activity: true },
    }), () => current, 42, 7);

    expect(mutation?.value).toMatchObject({ updatedAt: 42, recencyAt: 10, unread: 0 });
  });

  it("reorders Recent when a user message starts a turn", () => {
    const current = summary();
    const mutation = projectThreadSummaryEvent("server", semanticEvent({
      kind: "turnStarted",
      summary: { activity: true, conversationMessage: true, previewText: "New prompt" },
    }), () => current, 42, 7);

    expect(mutation?.value).toMatchObject({ preview: "New prompt", updatedAt: 42, recencyAt: 42, unread: 0 });
  });

  it("marks only the final agent bubble of a completed turn unread", () => {
    const current = summary();
    const mutation = projectThreadSummaryEvent("server", semanticEvent({
      kind: "turnCompleted",
      summary: {
        activity: true,
        conversationMessage: true,
        finalAgentResponse: true,
        previewText: "Final answer",
      },
    }), () => current, 42, 8);

    expect(mutation?.value).toMatchObject({
      preview: "Final answer",
      updatedAt: 42,
      recencyAt: 42,
      latestActivityCursor: 8,
      lastSeenCursor: 0,
      unread: 1,
    });
  });

  it("does not write the summary or relight unread state for token usage", () => {
    const current = { ...summary(), latestActivityCursor: 9, lastSeenCursor: 9, unread: 0 };
    const mutation = projectThreadSummaryEvent("server", semanticEvent({
      kind: "tokenUsage",
      summary: { activity: true },
    }), () => current, 42, 10);

    expect(mutation).toBeNull();
  });

  it("deletes only the addressed summary", () => {
    expect(projectThreadSummaryEvent("server", semanticEvent({ kind: "threadDeleted" }), () => summary()))
      .toEqual({ key: threadSummaryKey("server", "thread"), value: null });
  });

  it("keeps a new empty shell until its first activity", () => {
    const started = projectThreadSummaryEvent("server", semanticEvent({
      kind: "threadStarted",
      thread: thread(),
    }), () => undefined)?.value;
    expect(started).not.toBeNull();
    expect(retainThreadSummaryMissingFromSnapshot(started as StoredThreadSummary)).toBe(true);

    const active = projectThreadSummaryEvent("server", semanticEvent({
      kind: "turnStarted",
      summary: { activity: true },
    }), () => started ?? undefined, 42, 1)?.value;
    expect(active).toMatchObject({ provisionalThread: null });
    expect(retainThreadSummaryMissingFromSnapshot(active as StoredThreadSummary)).toBe(false);
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
