const QUESTION_TITLE_BYTES = 512;
import type { PendingServerRequest } from "../../../data/pending-request-types";
import { unknownRecord } from "../../../data/unknownRecord";

/** Validated presentation contract shared by both question transports. */
export type Question = {
  readonly id: string;
  readonly options: readonly { readonly description: string; readonly label: string }[];
  readonly secret: boolean;
  readonly title: string;
};
/** Choice and custom text coexist so switching choices never discards typed text. */
export type AnswerDraft = { readonly custom: string; readonly selected: number | null };
/** Stable question identity and its distinct response transport. */
export type QuestionInteraction = {
  readonly key: string;
  readonly questions: readonly Question[];
  readonly transport:
    | { readonly blocking: boolean; readonly kind: "rpc"; readonly request: PendingServerRequest }
    | { readonly itemId: string; readonly kind: "message"; readonly turnId: string };
};

/** Validates the legacy RPC boundary without treating arbitrary tool payloads as forms. */
export function rpcQuestions(request: PendingServerRequest): QuestionInteraction | null {
  if (request.method !== "item/tool/requestUserInput" || !Array.isArray(request.params.questions)) {
    return null;
  }
  const questions: Question[] = [];
  for (const value of request.params.questions) {
    const question = readRpcQuestion(value);
    if (question === null || questions.some((existing) => existing.id === question.id)) {
      return null;
    }
    questions.push(question);
  }
  return questions.length === 0
    ? null
    : {
        key: JSON.stringify([request.connectionId, request.requestKey, request.createdAt]),
        questions,
        transport: { blocking: request.params.isBlocking !== false, kind: "rpc", request },
      };
}

function readRpcQuestion(value: unknown): Question | null {
  const row = unknownRecord(value);
  if (
    typeof row?.id !== "string" ||
    typeof row.question !== "string" ||
    row.question.trim() === ""
  ) {
    return null;
  }
  if (row.isSecret !== undefined && typeof row.isSecret !== "boolean") {
    return null;
  }
  const options = readOptions(row.options);
  return options === null
    ? null
    : { id: row.id, options, secret: row.isSecret === true, title: row.question };
}
function readOption(value: unknown): Question["options"][number] | null {
  const row = unknownRecord(value);
  if (
    typeof row?.label !== "string" ||
    row.label.trim() === "" ||
    typeof row.description !== "string"
  ) {
    return null;
  }
  return { description: row.description, label: row.label };
}

function readOptions(value: unknown): Question["options"] | null {
  if (value === null || value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const options: { description: string; label: string }[] = [];
  for (const item of value) {
    const option = readOption(item);
    if (option === null) {
      return null;
    }
    options.push(option);
  }
  return options;
}

/** Converts the typed Astra message at the protocol boundary into the form contract. */
export function messageQuestions(
  scope: { connectionId: string; threadId: string; turnId: string },
  value: unknown,
): QuestionInteraction | null {
  const item = unknownRecord(value);
  if (item?.type !== "agentMessage" || item.delivery !== "async" || typeof item.id !== "string") {
    return null;
  }
  const questions = readAsyncQuestions(item.questions);
  if (questions === null) {
    return null;
  }
  return {
    key: JSON.stringify([scope.connectionId, scope.threadId, item.id]),
    questions,
    transport: { itemId: item.id, kind: "message", turnId: scope.turnId },
  };
}
function readAsyncQuestions(value: unknown): Question[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const questions: Question[] = [];
  for (const [index, candidate] of value.entries()) {
    const question = readAsyncQuestion(candidate, String(index));
    if (question === null) {
      return null;
    }
    questions.push(question);
  }
  return questions;
}
function readAsyncQuestion(value: unknown, id: string): Question | null {
  const row = unknownRecord(value);
  if (typeof row?.title !== "string" || row.title.trim() === "") {
    return null;
  }
  const options = readAsyncOptions(row.options);
  return options === null ? null : { id, options, secret: false, title: row.title };
}
function readAsyncOptions(value: unknown): Question["options"] | null {
  if (value === null || value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const options: { description: string; label: string }[] = [];
  for (const label of value) {
    if (typeof label !== "string" || label.trim() === "") {
      return null;
    }
    options.push({ description: "", label });
  }
  return options;
}

/** Resolves only an explicit choice or a nonempty custom answer. */
export function answerText(question: Question, draft: AnswerDraft): string {
  return draft.selected === null
    ? draft.custom.trim()
    : (question.options[draft.selected]?.label ?? "");
}

/** Matches Codex's bounded answered-question framing; answers remain ordinary user input. */
export function questionReply(
  questions: readonly Question[],
  drafts: readonly AnswerDraft[],
): string {
  return questions
    .map((question, index) => {
      let title = "";
      let bytes = 0;
      for (const character of question.title) {
        const size = new TextEncoder().encode(character).length;
        if (bytes + size > QUESTION_TITLE_BYTES) {
          break;
        }
        title += character;
        bytes += size;
      }
      return `> ${title.replaceAll(/[\r\n]/g, " ")}\n\n${answerText(question, drafts[index] ?? { custom: "", selected: null })}`;
    })
    .join("\n\n");
}
