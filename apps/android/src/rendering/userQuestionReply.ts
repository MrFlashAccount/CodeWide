const OPEN = "<send_user_message_question_reply>";
const CLOSE = "</send_user_message_question_reply>";

type QuestionReply = {
  readonly answer: string;
  readonly question: string;
  readonly questionItemId: string;
};

function isQuestionReply(value: unknown): value is QuestionReply {
  return (
    typeof value === "object" &&
    value !== null &&
    "questionItemId" in value &&
    typeof value.questionItemId === "string" &&
    "question" in value &&
    typeof value.question === "string" &&
    "answer" in value &&
    typeof value.answer === "string"
  );
}

/** Extracts authored answers only from a complete, validated Desktop reply envelope. */
export function userQuestionReplyText(source: string): string | null {
  const trimmed = source.trim();
  if (!trimmed.startsWith(OPEN) || !trimmed.endsWith(CLOSE)) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(trimmed.slice(OPEN.length, -CLOSE.length));
  } catch {
    return null;
  }
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const answers: string[] = [];
  const entries: readonly unknown[] = value;
  for (const entry of entries) {
    if (!isQuestionReply(entry)) {
      return null;
    }
    answers.push(entry.answer);
  }
  return answers.join("\n\n");
}
