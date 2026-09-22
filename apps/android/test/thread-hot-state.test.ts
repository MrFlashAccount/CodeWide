import { describe, expect, it } from "vitest";

import { projectThreadHotStates } from "../src/data/thread-hot-state";
import type { PendingServerRequest } from "../src/data/pending-request-types";
import { summary as createSummary } from "./fixtures/thread-summary";

const summary = createSummary("thread");

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

it("drops a closed-turn question while preserving unrelated pending approvals", () => {
  const question: PendingServerRequest = {
    connectionId: "server", createdAt: 0, requestId: "question", requestKey: "question",
    state: "pending", method: "item/tool/requestUserInput", params: { threadId: "thread", turnId: "closed" },
  };
  const closed = { ...summary, closedQuestionTurnId: "closed" };
  expect(projectThreadHotStates([closed], [question])[0]?.pendingRequestCount).toBe(0);
  const approval = { ...question, requestId: "approval", requestKey: "approval", method: "item/commandExecution/requestApproval" };
  expect(projectThreadHotStates([closed], [question, approval])[0]?.pendingRequestCount).toBe(1);
  const next = { ...question, params: { threadId: "thread", turnId: "next" } };
  expect(projectThreadHotStates([closed], [next])[0]?.pendingRequestCount).toBe(1);
});

it("clears only answered RPC attention immediately and restores it on admission failure", () => {
  const row = createSummary("thread", { status: { type: "active", activeFlags: ["waitingOnUserInput"] }, unread: 1 });
  const request: PendingServerRequest = { connectionId: "server", createdAt: 0, requestId: 1, requestKey: "key", state: "resolving", method: "item/tool/requestUserInput", params: { threadId: "thread", turnId: "turn" } };
  const answered = projectThreadHotStates([row], [request])[0];
  expect(answered).toMatchObject({ pendingRequestCount: 0, status: { type: "active", activeFlags: [] }, unread: 1 });
  const failed = projectThreadHotStates([row], [{ ...request, state: "pending" }])[0];
  expect(failed).toMatchObject({ pendingRequestCount: 1, status: { activeFlags: ["waitingOnUserInput"] } });
  const approval = { ...request, method: "item/commandExecution/requestApproval" };
  expect(projectThreadHotStates([row], [request, approval])[0]?.pendingRequestCount).toBe(1);
  const next = { ...request, requestKey: "new", state: "pending" as const };
  expect(projectThreadHotStates([row], [request, next])[0]).toMatchObject({ pendingRequestCount: 1, status: { activeFlags: ["waitingOnUserInput"] } });
  expect(projectThreadHotStates([row], [next, request])[0]).toMatchObject({ pendingRequestCount: 1, status: { activeFlags: ["waitingOnUserInput"] } });
});

it("retires a stale waiting-on-input flag for an admitted async answer without hiding approvals", () => {
  const row = createSummary("thread", {
    pendingQuestion: { turnId: "turn", itemIds: ["question"] },
    submittedQuestions: { turnId: "turn", itemIds: ["question"] },
    status: { type: "active", activeFlags: ["waitingOnUserInput", "waitingOnApproval"] },
  });
  expect(projectThreadHotStates([row], [])[0]?.status).toEqual({ type: "active", activeFlags: ["waitingOnApproval"] });
  const failed = { ...row, submittedQuestions: null };
  expect(projectThreadHotStates([failed], [])[0]?.status).toBe(row.status);
});
