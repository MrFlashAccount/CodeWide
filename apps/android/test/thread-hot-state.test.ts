import { describe, expect, it } from "vitest";

import { projectThreadHotStates } from "../src/data/thread-hot-state";
import type { PendingServerRequest } from "../src/data/pending-request-types";
import type { StoredThreadSummary } from "../src/data/thread-summary-types";

const summary = {
  connectionId: "server",
  remoteThreadId: "thread",
  pendingRequestCount: 0,
} as StoredThreadSummary;

describe("thread hot state", () => {
  it("projects pending approvals once at the data boundary", () => {
    const requests = [
      { connectionId: "server", state: "pending", params: { threadId: "thread" } },
      { connectionId: "server", state: "resolving", params: { threadId: "thread" } },
      { connectionId: "other", state: "pending", params: { threadId: "thread" } },
    ] as PendingServerRequest[];

    // Resolving requests remain outstanding until the server removes them. If
    // we drop them here, the approval marker flickers during command delivery.
    expect(projectThreadHotStates([summary], requests)[0]?.pendingRequestCount).toBe(2);
  });

  it("preserves row identity when the hot projection did not change", () => {
    expect(projectThreadHotStates([summary], [])[0]).toBe(summary);
  });
});
