import { describe, expect, it } from "vitest";

import { projectThreadSummaryEvent } from "../src/data/thread-summary-projection";
import type { StoredThreadSummary } from "../src/data/thread-summary-types";

function summary(): StoredThreadSummary {
  return {
    archived: false,
    connectionId: "server",
    cwd: "/repo",
    deleteCommandId: null,
    lastSeenCursor: 4,
    latestActivityCursor: 4,
    name: "Thread",
    pendingRequestCount: 0,
    pinned: false,
    preview: "Earlier answer",
    provisionalThread: null,
    recencyAt: 10,
    remoteThreadId: "thread",
    status: { activeFlags: [], type: "active" },
    unread: 2,
    updatedAt: 10,
  };
}

// Wire vector of `companion/thread/preview/updated` (docs/companion-sync-interest.md).
function previewEvent(previewText: string): Record<string, unknown> {
  return {
    codewideThreadPatch: {
      operation: {
        kind: "threadPreview",
        summary: { activity: true, conversationMessage: false, finalAgentResponse: false, previewText },
      },
      threadId: "thread",
      version: 1,
    },
    method: "companion/thread/preview/updated",
    params: { threadId: "thread" },
  };
}

describe("thread preview summary projection", () => {
  it("updates the preview of an unsubscribed row without touching recency or unread", () => {
    const projected = projectThreadSummaryEvent(
      "server",
      previewEvent("Streaming answer so far"),
      () => summary(),
      50,
      9,
    );

    expect(projected?.value).toMatchObject({
      latestActivityCursor: 9,
      preview: "Streaming answer so far",
      recencyAt: 10,
      unread: 2,
      updatedAt: 50,
    });
  });
});
