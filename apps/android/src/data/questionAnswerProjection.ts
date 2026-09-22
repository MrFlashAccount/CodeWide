import type { NativeCommandDelivery } from "../native/native-transport-contract";
import { questionCommandId } from "./questionAnswerIdentity";
import type { QuestionOpportunity, StoredThreadSummary } from "./thread-summary-types";

/** Narrows outbox events before any catalog lookup. */
export function isQuestionAnswerDelivery(delivery: NativeCommandDelivery): boolean {
  return (
    (delivery.method === "turn/start" || delivery.method === "turn/steer") &&
    delivery.threadId !== null &&
    delivery.commandId.startsWith("question-answer-")
  );
}

/** Native admission clears only the matching question; failure restores its opportunity. */
export function projectQuestionAnswerDelivery(
  row: StoredThreadSummary,
  delivery: NativeCommandDelivery,
): StoredThreadSummary {
  const pending = row.pendingQuestion;
  if (pending === null || pending === undefined || !questionDeliveryMatchesRow(row, delivery)) {
    return row;
  }
  const itemId = pending.itemIds.find(
    (id) => questionCommandId(row.remoteThreadId, id) === delivery.commandId,
  );
  if (itemId === undefined) {
    return row;
  }
  const submitted = questionIdsForTurn(row.submittedQuestions, pending.turnId);
  const failed = delivery.state === "failed";
  if (submitted.includes(itemId) !== failed) {
    return row;
  }
  return {
    ...row,
    submittedQuestions: {
      itemIds: failed ? submitted.filter((id) => id !== itemId) : [...submitted, itemId],
      turnId: pending.turnId,
    },
  };
}

function questionDeliveryMatchesRow(
  row: StoredThreadSummary,
  delivery: NativeCommandDelivery,
): boolean {
  return row.connectionId === delivery.connectionId && row.remoteThreadId === delivery.threadId;
}

/** Whether any observed async question still needs user input. */
export function hasUnansweredAsyncQuestion(thread: StoredThreadSummary): boolean {
  const pending = thread.pendingQuestion;
  if (pending === null || pending === undefined) {
    return false;
  }
  const skipped = questionIdsForTurn(thread.skippedQuestions, pending.turnId);
  const submitted = questionIdsForTurn(thread.submittedQuestions, pending.turnId);
  return pending.itemIds.some((id) => !skipped.includes(id) && !submitted.includes(id));
}

function questionIdsForTurn(
  opportunity: QuestionOpportunity | null | undefined,
  turnId: string,
): readonly string[] {
  return opportunity?.turnId === turnId ? opportunity.itemIds : [];
}
