import type { QuestionOpportunity } from "../../../data/thread-summary-types";
import { useThreadSummaryView } from "../../../data/use-thread-summary-view";
import { projectedQuestionHistory } from "@codewide/sync-client";
import { currentAsyncQuestions, isFinalQuestionTurnMessage } from "../../../data/questionLifecycle";
import { questionCommandId } from "../../../data/questionAnswerIdentity";
import { commandReceiptsFromTurn } from "../../../data/command-receipt-evidence";
import type { PendingServerRequest } from "../../../data/pending-request-types";
import type { ProjectedThreadChatTimelineEntry } from "../../../data/thread-chat-projection";
import type { RequestsWorkspaceCapabilities } from "../workspaceCapabilities";
import { messageQuestions, type QuestionInteraction } from "./questionContract";
/** Scoped sources used to resolve and answer a conversation question. */
export type QuestionConversation = {
  readonly activeTurnId: string | null;
  readonly connectionId: string;
  readonly entries: readonly ProjectedThreadChatTimelineEntry[];
  readonly insertOption?: ((text: string) => void) | undefined;
  readonly latestHistoryPresent: boolean;
  readonly onRespond:
    | ((request: PendingServerRequest, result: unknown) => Promise<void>)
    | undefined;
  readonly pendingRequest: PendingServerRequest | null;
  readonly sendAnswer: RequestsWorkspaceCapabilities["sendQuestionAnswer"] | undefined;
  readonly summaries?:
    | ReturnType<RequestsWorkspaceCapabilities["getQuestionSummaries"]>
    | undefined;
  readonly threadId: string;
};

/** Reads the current async question and its local dismissal. */
export function useCurrentQuestion(context: QuestionConversation): QuestionInteraction | undefined {
  const summaryView = useThreadSummaryView(
    context.summaries ?? null,
    {
      archivedLimit: 0,
      connectionId: context.connectionId,
      recentLimit: 0,
      selectedConnectionId: context.connectionId,
      selectedThreadId: context.threadId,
      subagentConnectionId: null,
      subagentLimit: 0,
      viewId: "question-visibility",
    },
    false,
  );
  // The live turn owns the question. A delayed or failed catalog read must not
  // hide it; the catalog contributes only the local Skip marker once available.
  return currentQuestion(context, summaryView?.selected[0]?.skippedQuestions);
}
function currentQuestion(
  context: QuestionConversation,
  skipped: QuestionOpportunity | null | undefined,
): QuestionInteraction | undefined {
  const lastTurnIndex = context.entries.findLastIndex((entry) => entry.kind === "turn");
  if (
    context.entries.some(
      (entry, index) =>
        index > lastTurnIndex && entry.kind === "delivery" && entry.delivery.state !== "failed",
    )
  ) {
    return undefined;
  }
  const skippedIds = new Set(skipped?.itemIds);
  const current = currentAsyncQuestions(
    context.entries.flatMap((entry) => (entry.kind === "turn" ? [entry.turn] : [])),
  );
  for (const { item, turnId } of current) {
    if (skipped?.turnId === turnId && skippedIds.has(item.id)) {
      continue;
    }
    const question = unansweredQuestion(context, item, turnId);
    if (question !== undefined) {
      return question;
    }
  }
  return undefined;
}
function unansweredQuestion(
  context: QuestionConversation,
  item: Parameters<typeof messageQuestions>[1],
  turnId: string,
): QuestionInteraction | undefined {
  if (!questionTurnIsCurrent(context, turnId)) {
    return undefined;
  }
  const question = messageQuestions(
    { connectionId: context.connectionId, threadId: context.threadId, turnId },
    item,
  );
  if (question === null || question.transport.kind !== "message") {
    return undefined;
  }
  const commandId = questionCommandId(context.threadId, question.transport.itemId);
  return answerEvidence(context, commandId, context.threadId).delivered ? undefined : question;
}
function questionTurnIsCurrent(context: QuestionConversation, turnId: string): boolean {
  return (
    (context.latestHistoryPresent || turnId === context.activeTurnId) &&
    (context.activeTurnId === null || turnId === context.activeTurnId)
  );
}

/** Reads durable answer delivery evidence. */
export function answerEvidence(
  context: QuestionConversation | null,
  commandId: string,
  threadId: string,
): { delivered: boolean; failed: boolean } {
  const entries = context?.entries ?? [];
  const delivered = entries.some(
    (entry) =>
      entry.kind === "turn" &&
      commandReceiptsFromTurn(threadId, entry.turn).some(
        (receipt) => receipt.commandId === commandId,
      ),
  );
  const pending = entries.find(
    (entry) => entry.kind === "delivery" && entry.delivery.commandId === commandId,
  );
  return {
    delivered,
    failed: pending?.kind === "delivery" && pending.delivery.state === "failed",
  };
}

/** Matches a live RPC to its terminal history evidence. */
export function rpcClosedInHistory(context: QuestionConversation): boolean {
  const request = context.pendingRequest;
  return (
    request !== null &&
    context.entries.some(
      (entry) =>
        entry.kind === "turn" &&
        entry.turn.id === request.params.turnId &&
        (entry.turn.status !== "inProgress" ||
          entry.turn.items.some(isFinalQuestionTurnMessage) ||
          projectedQuestionHistory(entry.turn).some(
            (question) =>
              question.itemId === request.params.itemId && question.outcome.status === "answered",
          )),
    )
  );
}
