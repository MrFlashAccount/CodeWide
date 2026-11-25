import { createContext, useContext } from "react";
import type { TurnSendOptions } from "../../data/thread-delivery-state";

/** An immutable target for a Send activation, including delayed voice completion. */
export type QuestionReply = (text: string, options: TurnSendOptions) => Promise<string>;

/** Shares one active question between its timeline entry and composer. */
export const QuestionContext = createContext<{
  content: React.JSX.Element | null;
  reply: QuestionReply | null;
}>({ content: null, reply: null });

/** Returns the send target rendered with the current chat. */
export function useQuestionReply(): QuestionReply | null {
  return useContext(QuestionContext).reply;
}
