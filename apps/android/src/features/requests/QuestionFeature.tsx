import type { QuestionOpportunity } from "../../data/thread-summary-types";
import { useThreadSummaryView } from "../../data/use-thread-summary-view";
import { projectedQuestionHistory } from "@codewide/sync-client";
import { currentAsyncQuestions, isFinalQuestionTurnMessage } from "../../data/questionLifecycle";
import { ScrollView, useWindowDimensions, View } from "react-native";
import { questionCommandId } from "../../data/questionAnswerIdentity";
import { createContext, useContext, type ReactNode } from "react";
import { commandReceiptsFromTurn } from "../../data/command-receipt-evidence";
import type { PendingServerRequest } from "../../data/pending-request-types";
import type { ProjectedThreadChatTimelineEntry } from "../../data/thread-chat-projection";
import { useEvent } from "../../react/useEvent";
import { QuestionCard } from "./questions/QuestionCard";
import {
  answerText,
  messageQuestions,
  questionReply,
  rpcQuestions,
  type AnswerDraft,
  type QuestionInteraction,
} from "./questions/questionContract";
import type { RequestsWorkspaceCapabilities } from "./workspaceCapabilities";
import { styles } from "./questions/QuestionCard.styles";

type QuestionConversation = {
  readonly activeTurnId: string | null;
  readonly connectionId: string;
  readonly entries: readonly ProjectedThreadChatTimelineEntry[];
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
const QUESTION_DOCK_HEIGHT_RATIO = 0.4;
const QuestionContext = createContext<QuestionConversation | null>(null);

/** Binds question forms to the existing conversation transport without using the composer draft. */
export function QuestionConversationProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: QuestionConversation;
}): React.JSX.Element | null {
  return <QuestionContext.Provider value={value}>{children}</QuestionContext.Provider>;
}

function MessageQuestionCard({
  context,
  interaction,
  threadId,
}: {
  context: QuestionConversation | null;
  interaction: QuestionInteraction;
  threadId: string;
}): React.JSX.Element | null {
  const sourceId = interaction.transport.kind === "message" ? interaction.transport.itemId : "";
  const commandId = questionCommandId(threadId, sourceId);
  const { delivered, failed, reply } = answerEvidence(context, commandId, threadId);
  const skip = useEvent(async () => {
    if (
      context?.summaries === null ||
      context?.summaries === undefined ||
      interaction.transport.kind !== "message"
    ) {
      throw new Error("Question dismissal is unavailable");
    }
    await context.summaries.skipQuestion({
      connectionId: context.connectionId,
      itemId: interaction.transport.itemId,
      threadId,
      turnId: interaction.transport.turnId,
    });
  });
  const send = useEvent(async (drafts: readonly AnswerDraft[], retry: boolean) => {
    if (context?.sendAnswer === undefined) {
      throw new Error("Question reply is unavailable");
    }
    await context.sendAnswer({
      commandId,
      connectionId: context.connectionId,
      mode:
        context.activeTurnId === null
          ? { type: "start" }
          : { expectedTurnId: context.activeTurnId, type: "steer" },
      retry,
      text: questionReply(interaction.questions, drafts),
      threadId,
    });
  });
  return (
    <QuestionCard
      canSend={context?.sendAnswer !== undefined}
      delivered={delivered}
      deliveredReply={reply}
      failed={failed}
      hideWhenSubmitted
      interaction={interaction}
      onSkip={skip}
      send={send}
      statusText={
        (context?.activeTurnId ?? null) !== null ? "Агент продолжает работу" : "Можно ответить"
      }
    />
  );
}

/** Adapts a blocking or nonblocking RPC question to the same neutral card. */
export function RpcQuestionCard({
  onRespond,
  request,
}: {
  onRespond: ((request: PendingServerRequest, result: unknown) => Promise<void>) | undefined;
  request: PendingServerRequest;
}): React.JSX.Element | null {
  const interaction = rpcQuestions(request);
  const skip = useEvent(async () => {
    if (onRespond === undefined) {
      throw new Error("Question response is unavailable");
    }
    await onRespond(request, { answers: {} });
  });
  const send = useEvent(async (drafts: readonly AnswerDraft[]) => {
    if (interaction === null || onRespond === undefined) {
      throw new Error("Question reply is unavailable");
    }
    await onRespond(request, {
      answers: Object.fromEntries(
        interaction.questions.map((question, index) => [
          question.id,
          { answers: [answerText(question, drafts[index] ?? { custom: "", selected: null })] },
        ]),
      ),
    });
  });
  if (interaction === null) {
    return null;
  }
  return (
    <QuestionCard
      canSend={onRespond !== undefined && request.state !== "resolving"}
      delivered={false}
      failed={false}
      interaction={interaction}
      onSkip={skip}
      send={send}
      statusText={
        interaction.transport.kind === "rpc" && interaction.transport.blocking
          ? "Агент ждёт ответа"
          : "Можно ответить"
      }
    />
  );
}

/** One current editor above the composer; historical rows never mount editors. */
export function QuestionDock(): React.JSX.Element | null {
  const context = useContext(QuestionContext);
  return context === null ? null : <BoundQuestionDock context={context} />;
}
function BoundQuestionDock({
  context,
}: {
  context: QuestionConversation;
}): React.JSX.Element | null {
  const { height } = useWindowDimensions();
  const interaction = useCurrentQuestion(context);
  const request = context.pendingRequest;
  const rpc = request === null ? null : rpcQuestions(request);
  const liveRpc = rpc !== null && request !== null && !rpcClosedInHistory(context);
  if (!liveRpc && interaction === undefined) {
    return null;
  }
  return (
    <View style={styles.dock} testID="question-dock">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        style={{ maxHeight: height * QUESTION_DOCK_HEIGHT_RATIO }}
      >
        {liveRpc ? (
          <RpcQuestionCard key={rpc.key} onRespond={context.onRespond} request={request} />
        ) : (
          interaction !== undefined && (
            <MessageQuestionCard
              context={context}
              interaction={interaction}
              key={interaction.key}
              threadId={context.threadId}
            />
          )
        )}
      </ScrollView>
    </View>
  );
}
function useCurrentQuestion(context: QuestionConversation): QuestionInteraction | undefined {
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

function answerEvidence(
  context: QuestionConversation | null,
  commandId: string,
  threadId: string,
): { delivered: boolean; failed: boolean; reply: string | null } {
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
    reply: confirmedReply(entries, commandId),
  };
}

function confirmedReply(
  entries: readonly ProjectedThreadChatTimelineEntry[],
  commandId: string,
): string | null {
  for (const entry of entries) {
    if (entry.kind !== "turn") {
      continue;
    }
    for (const item of entry.turn.items) {
      if (item.type === "userMessage" && item.clientId === commandId) {
        return item.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
      }
    }
  }
  return null;
}

function rpcClosedInHistory(context: QuestionConversation): boolean {
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
