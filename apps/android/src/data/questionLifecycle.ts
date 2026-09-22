import type { Thread, ThreadItem } from "@codewide/codex-protocol/v0.155.1/v2";
import { unknownRecord } from "./unknownRecord";

/** Validates the signal without retaining question text in catalog state. */
export function hasAsyncQuestions(value: unknown): boolean {
  const item = unknownRecord(value);
  return (
    item?.type === "agentMessage" &&
    item.delivery === "async" &&
    Array.isArray(item.questions) &&
    item.questions.length > 0 &&
    item.questions.every((value) => {
      const question = unknownRecord(value);
      return (
        typeof question?.title === "string" &&
        question.title.trim() !== "" &&
        (question.options === undefined ||
          question.options === null ||
          (Array.isArray(question.options) &&
            question.options.every((option) => typeof option === "string" && option.trim() !== "")))
      );
    })
  );
}

/** Current input opportunity, distinct from proof that a previous answer was delivered. */
export function currentAsyncQuestions(turns: Iterable<Thread["turns"][number]>): {
  readonly item: ThreadItem;
  readonly turnId: string;
}[] {
  const pending: { item: ThreadItem; turnId: string }[] = [];
  for (const turn of turns) {
    // A later turn supersedes questions from an earlier interaction even in summary pages.
    pending.length = 0;
    if (turn.status !== "inProgress") {
      continue;
    }
    if (!Array.isArray(turn.items) || turn.items.some(isFinalQuestionTurnMessage)) {
      continue;
    }
    for (const item of turn.items) {
      if (closesAsyncQuestions(item)) {
        pending.length = 0;
      } else if (hasAsyncQuestions(item)) {
        pending.push({ item, turnId: turn.id });
      }
    }
  }
  return pending;
}

/** User input or a normal final answer ends the async question opportunity. */
export function closesAsyncQuestions(value: unknown): boolean {
  const item = unknownRecord(value);
  return item?.type === "userMessage" || isFinalQuestionTurnMessage(value);
}

/** A normal final answer closes every question in its turn, including late replays. */
export function isFinalQuestionTurnMessage(value: unknown): boolean {
  const item = unknownRecord(value);
  return (
    item?.type === "agentMessage" && item.phase === "final_answer" && item.delivery !== "async"
  );
}
