import type { TurnSendOptions } from "../../../data/thread-delivery-state";
import type { QuestionReply } from "../questionReplyContext";
import type { QuestionConversation } from "./currentQuestion";
import type { QuestionInteraction } from "./questionContract";
import { deliverQuestionAnswers } from "./questionResponse";
import type { QuestionSession } from "./questionSession";

/** Everything needed to route one selected answer after asynchronous editor work. */
export type QuestionPage = {
  readonly context: QuestionConversation;
  readonly index: number;
  readonly interaction: QuestionInteraction;
  readonly session: QuestionSession;
};

/** Captures the page rather than redirecting an in-flight voice result to a newer question. */
export function createPageReply(
  page: QuestionPage | null,
  isCurrent: (page: QuestionPage) => boolean,
): QuestionReply {
  return async (text, options) => {
    if (page === null || !isCurrent(page) || !acceptsAnswer(page)) {
      throw new Error("Вопрос больше недоступен");
    }
    const { context, index, interaction, session } = page;
    session.setDraft(index, { custom: text, selected: null, ...fileOptions(options) });
    if (index + 1 < interaction.questions.length) {
      session.setPage(index + 1);
    } else {
      await session.submit(async (drafts, retry) =>
        deliverQuestionAnswers(context, interaction, { drafts, options, retry }),
      );
      if (session.state$.peek().delivery.status === "failed") {
        throw new Error("Не удалось отправить ответ");
      }
    }
    return interaction.key;
  };
}

function acceptsAnswer({ index, session }: QuestionPage): boolean {
  const state = session.state$.peek();
  return (
    state.page === index &&
    state.delivery.status === "editing" &&
    (state.skipState === "ready" || state.skipState === "failed")
  );
}

function fileOptions(options: TurnSendOptions): Pick<TurnSendOptions, "attachments"> {
  return options.attachments === undefined ? {} : { attachments: options.attachments };
}
