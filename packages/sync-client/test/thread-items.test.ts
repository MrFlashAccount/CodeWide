import type { ThreadItem } from "@codewide/codex-protocol/v0.147.0/v2";
import { describe, expect, it } from "vitest";

import { reconcileTurnItems } from "../src/thread-items";

function user(id: string, clientId: string | null): ThreadItem {
  return { type: "userMessage", id, clientId, content: [{ type: "text", text: "Hello", text_elements: [] }] };
}

function agent(id: string, text = "Done"): ThreadItem {
  return { type: "agentMessage", id, text, phase: "final_answer", memoryCitation: null };
}

describe("turn item reconciliation", () => {
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
});
