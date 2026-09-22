import { describe, expect, it } from "vitest";
import type { Turn } from "@codewide/codex-protocol/v0.155.1/v2";
import { projectedQuestionHistory } from "../src/question-history";

const question = { id: "q", title: "Where?", secret: false, options: [{ label: "Here", description: "Local" }] };
const history = { itemId: "call", questions: [question], outcome: { status: "answered", answers: [{ questionId: "q", answer: { kind: "text", values: ["Here"] } }] } };
function turn(questions: unknown): Turn {
  return Object.assign({ id: "turn", items: [], status: "completed" as const, itemsView: "summary" as const, error: null, startedAt: null, completedAt: null, durationMs: null }, { codewide: { questions } });
}

describe("rollout question boundary", () => {
  it("retains structured answers and leaves missing results unconfirmed", () => {
    expect(projectedQuestionHistory(turn([history]))).toEqual([history]);
    const unanswered = { ...history, outcome: { status: "unconfirmed" } };
    expect(projectedQuestionHistory(turn([unanswered]))).toEqual([unanswered]);
  });
  it("rejects malformed and uncorrelated answers without manufacturing success", () => {
    for (const value of [null, { ...history, questions: [question, question] }, { ...history, outcome: { status: "answered", answers: [] } }, { ...history, outcome: { status: "answered", answers: [{ questionId: "other", answer: { kind: "text", values: ["No"] } }] } }]) {
      expect(projectedQuestionHistory(turn([value]))).toEqual([]);
    }
  });
  it("redacts secret content even from a malformed sender and deduplicates replay", () => {
    const secret = { ...history, questions: [{ ...question, secret: true }] };
    expect(projectedQuestionHistory(turn([secret, secret]))).toEqual([{ ...secret, outcome: { status: "answered", answers: [{ questionId: "q", answer: { kind: "secret" } }] } }]);
  });
});
