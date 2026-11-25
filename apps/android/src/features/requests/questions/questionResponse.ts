import type { TurnSendOptions } from "../../../data/thread-delivery-state";
import { questionCommandId } from "../../../data/questionAnswerIdentity";
import type { QuestionConversation } from "./currentQuestion";
import {
  answerText,
  questionReply,
  type AnswerDraft,
  type QuestionInteraction,
} from "./questionContract";

/** Submits the complete form to its original request or correlated message command. */
export async function deliverQuestionAnswers(
  context: QuestionConversation,
  interaction: QuestionInteraction,
  {
    drafts,
    options,
    retry,
  }: {
    readonly drafts: readonly AnswerDraft[];
    readonly options: TurnSendOptions;
    readonly retry: boolean;
  },
): Promise<void> {
  const { transport } = interaction;
  if (transport.kind === "rpc") {
    if (context.onRespond === undefined) {
      throw new Error("Question response is unavailable");
    }
    const answers = Object.fromEntries(
      interaction.questions.map((question, index) => {
        const draft = drafts[index] ?? { custom: "", selected: null };
        const text = answerText(question, draft);
        const files = draft.attachments;
        return [question.id, { answers: (files?.length ?? 0) > 0 ? [{ files, text }] : [text] }];
      }),
    );
    await context.onRespond(transport.request, { answers });
    return;
  }
  if (context.sendAnswer === undefined) {
    throw new Error("Question reply is unavailable");
  }
  const attachments = drafts.flatMap((draft) => draft.attachments ?? []);
  await context.sendAnswer({
    commandId: questionCommandId(context.threadId, transport.itemId),
    connectionId: context.connectionId,
    mode:
      context.activeTurnId === null
        ? { type: "start" }
        : { expectedTurnId: context.activeTurnId, type: "steer" },
    options: { ...options, attachments },
    retry,
    text: questionReply(interaction.questions, drafts),
    threadId: context.threadId,
  });
}

/** Dismisses only this question using the owner of its original transport. */
export async function skipTimelineQuestion(
  context: QuestionConversation,
  interaction: QuestionInteraction,
): Promise<void> {
  if (interaction.transport.kind === "rpc") {
    if (context.onRespond === undefined) {
      throw new Error("Question response is unavailable");
    }
    await context.onRespond(interaction.transport.request, { answers: {} });
  } else {
    if (context.summaries === undefined || context.summaries === null) {
      throw new Error("Question dismissal is unavailable");
    }
    await context.summaries.skipQuestion({
      connectionId: context.connectionId,
      itemId: interaction.transport.itemId,
      threadId: context.threadId,
      turnId: interaction.transport.turnId,
    });
  }
}
