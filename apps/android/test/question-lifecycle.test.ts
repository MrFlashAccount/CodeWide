import { questionAnswerDelivery } from "./fixtures/questionAnswer";
import { projectQuestionAnswerDelivery } from "../src/data/questionAnswerProjection";
import { projectThreadSummarySnapshot } from "../src/data/thread-summary-projection";
import { createV1TestThread } from "./fixtures/v1Thread";
import type { Turn } from "@codewide/codex-protocol/v0.155.1/v2";
import { expect, it } from "vitest";
import { currentAsyncQuestions } from "../src/data/questionLifecycle";
import { projectThreadSummaryEvent } from "../src/data/thread-summary-projection";
import { storedThreadToListItem } from "../src/features/threadList/threadListProjection";
import { summary } from "./fixtures/thread-summary";

const question: Turn["items"][number] = {
  type: "agentMessage", id: "question", text: "Pick", phase: null, memoryCitation: null,
  delivery: "async", questions: [{ title: "Pick", options: ["One", "Two"] }],
};
function turn(items: Turn["items"], status: Turn["status"] = "inProgress"): Turn {
  return { id: "turn", items, status, itemsView: "full", error: null, startedAt: null, completedAt: null, durationMs: null };
}
const user: Turn["items"][number] = {
  type: "userMessage", id: "user", clientId: null,
  content: [{ type: "text", text: "Continue", text_elements: [] }],
};

it("keeps questions only during an active turn and retires them on later input or completion", () => {
  expect(currentAsyncQuestions([turn([user, question])]).map(x => x.item.id)).toEqual(["question"]);
  expect(currentAsyncQuestions([turn([question, user])])).toEqual([]);
  for (const status of ["interrupted", "failed", "completed"] as const) {
    expect(currentAsyncQuestions([turn([question], status)])).toEqual([]);
  }
  expect(currentAsyncQuestions([turn([question]), { ...turn([]), id: "newer" }])).toEqual([]);
});

it("projects attention from journal questions and retires it at completion without an answer", () => {
  let row = summary("thread");
  const apply = (operation: Record<string, unknown>) => {
    const mutation = projectThreadSummaryEvent("server", {
      codewideThreadPatch: { version: 1, threadId: "thread", operation },
    }, () => row);
    expect(mutation?.value).not.toBeNull();
    row = mutation?.value ?? row;
  };
  apply({ kind: "itemUpsert", turnId: "turn", item: question });
  expect(storedThreadToListItem(row).needsAttention).toBe(true);
  apply({ kind: "turnCompleted", turn: turn([question], "completed") });
  expect(storedThreadToListItem(row).needsAttention).toBe(false);
  apply({ kind: "itemUpsert", turnId: "turn", item: question });
  expect(storedThreadToListItem(row).needsAttention).toBe(false);
  apply({ kind: "itemUpsert", turnId: "turn", item: user });
  expect(storedThreadToListItem(row).needsAttention).toBe(false);
});

it("requests attention for pending RPCs and waiting flags even when the chat is read", () => {
  expect(storedThreadToListItem(summary("rpc", { pendingRequestCount: 1 })).needsAttention).toBe(true);
  for (const flag of ["waitingOnApproval", "waitingOnUserInput"] as const) {
    expect(storedThreadToListItem(summary("waiting", { status: { type: "active", activeFlags: [flag] } })).needsAttention).toBe(true);
  }
  expect(storedThreadToListItem(summary("running", { status: { type: "active", activeFlags: [] } })).needsAttention).toBe(false);
});

it("retires attention when the answer arrives inside the completed turn instead of a separate user event", () => {
  const row = summary("thread", { pendingQuestion: { turnId: "turn", itemIds: ["question"] }, unread: 1 });
  const result = projectThreadSummaryEvent("server", {
    codewideThreadPatch: { version: 1, threadId: "thread", operation: {
      kind: "turnCompleted", turn: turn([question, { ...user, clientId: "accepted-answer" }]),
    } },
  }, () => row)?.value;
  expect(result).not.toBeNull();
  expect(result && storedThreadToListItem(result)).toMatchObject({ needsAttention: false, unread: 1 });
});

it("does not retire a newer question because an earlier turn finishes", () => {
  const row = summary("thread", { pendingQuestion: { turnId: "newer-turn", itemIds: ["question"] } });
  const result = projectThreadSummaryEvent("server", {
    codewideThreadPatch: { version: 1, threadId: "thread", operation: {
      kind: "turnCompleted", turn: turn([question, user]),
    } },
  }, () => row)?.value;
  expect(result && storedThreadToListItem(result).needsAttention).toBe(true);
});

it("skips all unanswered questions when their turn completes", () => {
  const row = summary("thread", { pendingQuestion: { turnId: "turn", itemIds: ["question"] } });
  const result = projectThreadSummaryEvent("server", {
    codewideThreadPatch: { version: 1, threadId: "thread", operation: {
      kind: "turnCompleted", turn: turn([question, user, { ...question, id: "next-question" }]),
    } },
  }, () => row)?.value;
  expect(result && storedThreadToListItem(result).needsAttention).toBe(false);
});

it("retires questions even when completion contains only summary items", () => {
  const row = summary("thread", { pendingQuestion: { turnId: "turn", itemIds: ["question"] } });
  const result = projectThreadSummaryEvent("server", {
    codewideThreadPatch: { version: 1, threadId: "thread", operation: {
      kind: "turnCompleted", turn: { ...turn([user]), itemsView: "summary" },
    } },
  }, () => row)?.value;
  expect(result && storedThreadToListItem(result).needsAttention).toBe(false);
});

it("keeps a question through commentary but clears it on the normal final answer", () => {
  const commentary = { ...question, id: "comment", delivery: null, questions: null, phase: "commentary" as const };
  const final = { ...commentary, id: "final", phase: "final_answer" as const };
  expect(currentAsyncQuestions([turn([question, commentary])]).map(x => x.item.id)).toEqual(["question"]);
  expect(currentAsyncQuestions([turn([question, final])])).toEqual([]);
  expect(currentAsyncQuestions([turn([final, question])])).toEqual([]);
  const row = summary("thread", { pendingQuestion: { turnId: "turn", itemIds: [question.id] } });
  const result = projectThreadSummaryEvent("server", {
    codewideThreadPatch: { version: 1, threadId: "thread", operation: { kind: "itemUpsert", turnId: "turn", item: final } },
  }, () => row)?.value;
  expect(result && storedThreadToListItem(result).needsAttention).toBe(false);
  const replay = projectThreadSummaryEvent("server", {
    codewideThreadPatch: { version: 1, threadId: "thread", operation: { kind: "itemUpsert", turnId: "turn", item: question } },
  }, () => result ?? row)?.value;
  expect(storedThreadToListItem(replay ?? result ?? row).needsAttention).toBe(false);
});

it("dismisses only the selected question, preserves unread and keeps independent approvals", () => {
  const row = summary("thread", {
    unread: 1,
    pendingQuestion: { turnId: "turn", itemIds: ["one", "two"] },
    skippedQuestions: { turnId: "turn", itemIds: ["one"] },
  });
  expect(storedThreadToListItem(row).needsAttention).toBe(true);
  const dismissed = { ...row, skippedQuestions: { turnId: "turn", itemIds: ["one", "two"] } };
  expect(storedThreadToListItem(dismissed)).toMatchObject({ needsAttention: false, unread: 1 });
  expect(storedThreadToListItem({ ...dismissed, pendingRequestCount: 1 }).needsAttention).toBe(true);
  expect(storedThreadToListItem({ ...dismissed, pendingQuestion: { turnId: "new-turn", itemIds: ["one"] } }).needsAttention).toBe(true);
});

it("correlates admission to one qualified question, preserving new questions and approvals through replay", () => {
  const row = summary("question-thread", { pendingQuestion: { turnId: "turn", itemIds: ["question"] } });
  const delivery = questionAnswerDelivery();
  expect(projectQuestionAnswerDelivery(row, { ...delivery, connectionId: "other" })).toBe(row);
  expect(projectQuestionAnswerDelivery(row, { ...delivery, commandId: "ordinary-message" })).toBe(row);
  const submitted = projectQuestionAnswerDelivery(row, delivery);
  expect(storedThreadToListItem(submitted).needsAttention).toBe(false);
  const replay = projectThreadSummarySnapshot("server", { ...createV1TestThread("question-thread", null, 1, [turn([question])]), status: { type: "active", activeFlags: [] } }, false, submitted);
  expect(storedThreadToListItem(replay).needsAttention).toBe(false);
  expect(storedThreadToListItem({ ...submitted, pendingRequestCount: 1 }).needsAttention).toBe(true);
  const newer = { ...submitted, pendingQuestion: { turnId: "turn", itemIds: ["question", "new"] } };
  expect(storedThreadToListItem(newer).needsAttention).toBe(true);
  const nextTurn = { ...submitted, pendingQuestion: { turnId: "new-turn", itemIds: ["new"] } };
  expect(projectQuestionAnswerDelivery(nextTurn, delivery)).toBe(nextTurn);
  expect(storedThreadToListItem(nextTurn).needsAttention).toBe(true);
});
