import { useSelector } from "@legendapp/state/react";
import { useLayoutEffect, useRef } from "react";
import { questionCommandId } from "../../../data/questionAnswerIdentity";
import { useEvent } from "../../../react/useEvent";
import { useAsyncResource } from "../../../rendering/async-resource-store";
import { AppText as Text } from "../../../ui/Typography";
import type { QuestionReply } from "../questionReplyContext";
import { QuestionCard } from "./QuestionCard";
import { styles } from "./QuestionCard.styles";
import { TimelineQuestionCard } from "./TimelineQuestionCard";
import {
  answerEvidence,
  rpcClosedInHistory,
  useCurrentQuestion,
  type QuestionConversation,
} from "./currentQuestion";
import { rpcQuestions, type QuestionInteraction } from "./questionContract";
import { createPageReply, type QuestionPage } from "./questionPage";
import { deliverQuestionAnswers, skipTimelineQuestion } from "./questionResponse";
import { loadQuestionSession, type QuestionSession } from "./questionSession";

type Binding = { content: React.JSX.Element | null; reply: QuestionReply | null };
const inactive: Binding = { content: null, reply: null };

function useActiveInteraction(context: QuestionConversation) {
  const asyncQuestion = useCurrentQuestion(context);
  const rpc =
    context.pendingRequest === null || rpcClosedInHistory(context)
      ? null
      : rpcQuestions(context.pendingRequest);
  return rpc ?? asyncQuestion ?? null;
}

function usePageStatus(session: QuestionSession | null, failed: boolean) {
  const phase = useSelector(() => session?.state$.delivery.status.get());
  const skip = useSelector(() => session?.state$.skipState.get());
  const storageError = useSelector(() => session?.state$.storageError.get());
  const failure = failed || phase === "failed";
  return {
    closed: skip === "skipped" || phase === "delivered" || (phase === "queued" && !failed),
    error: pageError(failure, skip === "failed", storageError === true),
    failed: failure,
    waiting: phase === "sending" || skip === "skipping",
  };
}
function pageError(failed: boolean, skipFailed: boolean, storage: boolean): string | null {
  if (failed) {
    return "Не удалось отправить ответ.";
  }
  if (skipFailed) {
    return "Не удалось пропустить вопрос.";
  }
  return storage ? "Не удалось сохранить черновик." : null;
}
function hasFailedMessage(
  context: QuestionConversation,
  interaction: QuestionInteraction | null,
): boolean {
  return (
    interaction?.transport.kind === "message" &&
    answerEvidence(
      context,
      questionCommandId(context.threadId, interaction.transport.itemId),
      context.threadId,
    ).failed
  );
}
function transportReady(
  context: QuestionConversation,
  interaction: QuestionInteraction | null,
): boolean {
  return interaction?.transport.kind === "rpc"
    ? context.onRespond !== undefined && context.pendingRequest?.state !== "resolving"
    : context.sendAnswer !== undefined;
}
function canAnswer(status: ReturnType<typeof usePageStatus>, ready: boolean): boolean {
  return ready && !status.waiting && !status.failed;
}
function useCurrentPage(page: QuestionPage | null, ready: boolean) {
  const ref = useRef<QuestionPage | null>(null);
  useLayoutEffect(() => {
    ref.current = ready ? page : null;
    return () => {
      ref.current = null;
    };
  }, [page, ready]);
  return useEvent(
    (captured: QuestionPage) =>
      ref.current?.session === captured.session && ref.current.index === captured.index,
  );
}

function useQuestionResource(interaction: QuestionInteraction | null) {
  return useAsyncResource(
    interaction === null ? null : `question:${interaction.key}`,
    0,
    async () => {
      if (interaction === null) {
        throw new Error("Missing question");
      }
      return loadQuestionSession(interaction);
    },
  );
}

/** Binds the transcript and composer to a single retained answer session. */
export function useTimelineQuestion(context: QuestionConversation): Binding {
  const interaction = useActiveInteraction(context);
  const resource = useQuestionResource(interaction);
  const session = resource.value;
  const index = useSelector(() => session?.state$.page.get() ?? 0);
  const status = usePageStatus(session, hasFailedMessage(context, interaction));
  const ready = transportReady(context, interaction);
  const page =
    interaction !== null && session !== null ? { context, index, interaction, session } : null;
  const current = useCurrentPage(page, canAnswer(status, ready));
  if (interaction === null || status.closed) {
    return inactive;
  }
  if (page === null) {
    return {
      content: (
        <Text style={styles.muted}>
          {resource.error === null ? "Вопрос агента" : "Не удалось восстановить ответ"}
        </Text>
      ),
      reply: createPageReply(null, current),
    };
  }
  return bindPage(page, { ...status, ready }, current);
}

function bindPage(
  page: QuestionPage,
  status: ReturnType<typeof usePageStatus> & { ready: boolean },
  current: (page: QuestionPage) => boolean,
): Binding {
  const { context, index, interaction, session } = page;
  const { ready } = status;
  if (interaction.questions.some((question) => question.secret)) {
    return {
      content: (
        <QuestionCard
          canSend={ready}
          delivered={false}
          failed={status.failed}
          interaction={interaction}
          key={interaction.key}
          onSkip={async () => skipTimelineQuestion(context, interaction)}
          send={async (drafts, retry) =>
            deliverQuestionAnswers(context, interaction, { drafts, options: {}, retry })
          }
          statusText="Агент ждёт ответа"
        />
      ),
      reply: null,
    };
  }
  const question = interaction.questions[index];
  if (question === undefined) {
    return inactive;
  }
  const reply = createPageReply(page, current);
  return {
    content: (
      <TimelineQuestionCard
        disabled={!canAnswer(status, ready)}
        error={status.error}
        onBack={() => {
          session.setPage(Math.max(0, index - 1));
        }}
        onChoose={(text) => {
          void reply(text, {}).catch(() => undefined);
        }}
        onEdit={context.insertOption}
        onRetry={
          ready && status.failed
            ? () => {
                retryPage(page);
              }
            : null
        }
        onSkip={() => {
          void session
            .skip(async () => skipTimelineQuestion(context, interaction))
            .catch(() => session.state$.skipState.set("failed"));
        }}
        page={index}
        question={question}
        total={interaction.questions.length}
      />
    ),
    reply,
  };
}

function retryPage({ context, interaction, session }: QuestionPage): void {
  const phase = session.state$.peek().delivery.status;
  if (phase === "queued" || phase === "editing") {
    session.state$.delivery.set({ status: "failed" });
  }
  void session
    .submit(async (drafts, retry) =>
      deliverQuestionAnswers(context, interaction, { drafts, options: {}, retry }),
    )
    .catch(() => session.state$.delivery.set({ status: "failed" }));
}
