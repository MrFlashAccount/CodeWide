import type { AnswerDraft, QuestionInteraction } from "./questionContract";
import type { QuestionSession, QuestionState } from "./questionSession";
/** Presentation-only editor operations never submit on page or selection changes. */
export type QuestionFormProps = {
  canSend: boolean;
  delivered: boolean;
  interaction: QuestionInteraction;
  onSkip: (() => void) | undefined;
  send: (drafts: readonly AnswerDraft[], retry: boolean) => Promise<void>;
  session: QuestionSession;
  state: QuestionState;
};
