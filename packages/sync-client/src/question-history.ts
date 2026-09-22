import type { Turn } from "@codewide/codex-protocol/v0.155.1/v2";

/** One validated RPC question reconstructed from the canonical rollout. */
export type HistoricalQuestion = {
  readonly id: string;
  readonly title: string;
  readonly secret: boolean;
  readonly options: readonly { readonly label: string; readonly description: string }[];
};

/** Secret answers retain receipt evidence without exposing their content. */
export type HistoricalAnswer = {
  readonly questionId: string;
  readonly answer:
    | { readonly kind: "secret" }
    | { readonly kind: "text"; readonly values: readonly string[] };
};

/** A missing tool result is not evidence of successful delivery or cancellation. */
export type QuestionHistory = {
  readonly itemId: string;
  readonly questions: readonly HistoricalQuestion[];
  readonly outcome:
    | { readonly status: "unconfirmed" }
    | { readonly status: "answered"; readonly answers: readonly HistoricalAnswer[] };
};

/** Validates Companion's question extension independently of generated Codex DTOs. */
export function projectedQuestionHistory(turn: Turn): readonly QuestionHistory[] {
  const metadata = "codewide" in turn ? record(turn.codewide) : null;
  if (!Array.isArray(metadata?.questions)) return [];
  const history: QuestionHistory[] = [];
  for (const value of metadata.questions) {
    const question = readHistory(value);
    if (question !== null && !history.some((entry) => entry.itemId === question.itemId)) history.push(question);
  }
  return history;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function readHistory(value: unknown): QuestionHistory | null {
  const row = record(value);
  if (typeof row?.itemId !== "string" || row.itemId === "" || !Array.isArray(row.questions) || row.questions.length === 0) return null;
  const questions: HistoricalQuestion[] = [];
  for (const value of row.questions) {
    const question = readQuestion(value);
    if (question === null || questions.some((entry) => entry.id === question.id)) return null;
    questions.push(question);
  }
  const outcome = readOutcome(row.outcome, questions);
  return outcome === null ? null : { itemId: row.itemId, questions, outcome };
}

function readQuestion(value: unknown): HistoricalQuestion | null {
  const row = record(value);
  if (typeof row?.id !== "string" || row.id === "" || typeof row.title !== "string" || row.title.trim() === "" || typeof row.secret !== "boolean" || !Array.isArray(row.options)) return null;
  const options: { label: string; description: string }[] = [];
  for (const value of row.options) {
    const option = record(value);
    if (typeof option?.label !== "string" || typeof option.description !== "string") return null;
    options.push({ label: option.label, description: option.description });
  }
  return { id: row.id, title: row.title, secret: row.secret, options };
}

function readOutcome(value: unknown, questions: readonly HistoricalQuestion[]): QuestionHistory["outcome"] | null {
  const row = record(value);
  if (row?.status === "unconfirmed") return { status: "unconfirmed" };
  if (row?.status !== "answered" || !Array.isArray(row.answers) || row.answers.length === 0) return null;
  const answers: HistoricalAnswer[] = [];
  for (const value of row.answers) {
    const entry = record(value);
    const question = questions.find((question) => question.id === entry?.questionId);
    if (question === undefined || answers.some((answer) => answer.questionId === question.id)) return null;
    const answer = readAnswer(entry?.answer, question.secret);
    if (answer === null) return null;
    answers.push({ questionId: question.id, answer });
  }
  return { status: "answered", answers };
}

function readAnswer(value: unknown, secret: boolean): HistoricalAnswer["answer"] | null {
  const row = record(value);
  if (secret && (row?.kind === "secret" || row?.kind === "text")) return { kind: "secret" };
  if (row?.kind !== "text" || !Array.isArray(row.values)) return null;
  const values: string[] = [];
  for (const value of row.values) {
    if (typeof value !== "string") return null;
    values.push(value);
  }
  return values.some((value) => value.trim() !== "") ? { kind: "text", values } : null;
}
