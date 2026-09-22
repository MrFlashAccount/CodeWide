import type { ThreadItem } from "@codewide/codex-protocol/v0.155.1/v2";
import { describe, expect, it } from "vitest";

import { reconcileActiveTurnItems, reconcileTurnItems } from "../src/thread-items";

function user(id: string, clientId: string | null): ThreadItem {
  return { type: "userMessage", id, clientId, content: [{ type: "text", text: "Hello", text_elements: [] }] };
}

function agent(id: string, text = "Done"): ThreadItem {
  return { delivery: null, questions: null, type: "agentMessage", id, text, phase: "final_answer", memoryCitation: null };
}

describe("turn item reconciliation", () => {
  it("retains async questions separately from final answers and replayed questions", () => {
    const question: ThreadItem = {
      type: "agentMessage", id: "question", text: "Which environment?",
      phase: "final_answer", memoryCitation: null, delivery: "async",
      questions: [{ title: "Which environment?", options: ["Test", "Production"] }],
    };
    const repeatedQuestion: ThreadItem = { ...question, id: "second-question" };
    const finalAnswer = agent("final", "Ready");
    const result = reconcileTurnItems([question], [repeatedQuestion, finalAnswer]);

    expect(result).toEqual([question, repeatedQuestion, finalAnswer]);
    expect(reconcileTurnItems(result, [question, repeatedQuestion, finalAnswer])).toEqual(result);
    expect(reconcileActiveTurnItems([finalAnswer], [question])).toEqual([finalAnswer, question]);
  });

  it("matches reconstructed chat boundaries when their item ids rotate", () => {
    const result = reconcileTurnItems(
      [user("live-user", "command"), agent("live-agent")],
      [user("history-user", null), agent("history-agent")],
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: "history-user", type: "userMessage", clientId: "command" });
    expect(result[1]).toMatchObject({ id: "history-agent", type: "agentMessage", text: "Done" });
  });

  it("preserves the multiplicity of legitimate repeated agent messages", () => {
    const result = reconcileTurnItems(
      [agent("cached", "Again")],
      [agent("first", "Again"), agent("second", "Again")],
    );

    expect(result.filter((item) => item.type === "agentMessage")).toHaveLength(2);
  });

  it("preserves the pre-turn marker when canonical history replaces a live item", () => {
    const cached = Object.assign(
      { type: "contextCompaction", id: "compaction" } as const,
      { codewidePreTurn: true, codewideLifecyclePhase: "started" as const },
    );
    const incoming: ThreadItem = { type: "contextCompaction", id: "compaction" };

    expect(reconcileTurnItems([cached], [incoming])).toEqual([
      expect.objectContaining({ codewidePreTurn: true }),
    ]);
    expect(reconcileTurnItems([cached], [incoming])[0]).not.toHaveProperty("codewideLifecyclePhase");
  });

  it("preserves lifecycle phase when an active snapshot replaces a live item", () => {
    const cached = Object.assign(
      { type: "contextCompaction", id: "compaction" } as const,
      { codewidePreTurn: true, codewideLifecyclePhase: "started" as const },
    );
    const incoming: ThreadItem = { type: "contextCompaction", id: "compaction" };

    expect(reconcileActiveTurnItems([cached], [incoming])).toEqual([
      expect.objectContaining({
        codewideLifecyclePhase: "started",
        codewidePreTurn: true,
      }),
    ]);
  });

  it("preserves richer streamed agent text across a bounded active snapshot", () => {
    const cached = [agent("agent", "A complete streamed update")];
    const incoming = [agent("agent", "A complete")];

    expect(reconcileActiveTurnItems(cached, incoming)).toEqual([
      expect.objectContaining({ text: "A complete streamed update" }),
    ]);
  });
});
