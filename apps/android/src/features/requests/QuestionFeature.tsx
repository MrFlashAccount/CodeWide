import { useContext, type ReactNode } from "react";
import type { PendingServerRequest } from "../../data/pending-request-types";
import { useEvent } from "../../react/useEvent";
import { QuestionCard } from "./questions/QuestionCard";
import { answerText, rpcQuestions, type AnswerDraft } from "./questions/questionContract";
import type { QuestionConversation } from "./questions/currentQuestion";
import { QuestionContext } from "./questionReplyContext";
import { useTimelineQuestion } from "./questions/useTimelineQuestion";

/** Provides the same active question to the timeline and the chat's existing send path. */
export function QuestionConversationProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: QuestionConversation;
}): React.JSX.Element {
  const binding = useTimelineQuestion(value);
  return <QuestionContext.Provider value={binding}>{children}</QuestionContext.Provider>;
}

/** Renders the current question inside the scrollable conversation. */
export function TimelineQuestion(): React.JSX.Element | null {
  return useContext(QuestionContext).content;
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
