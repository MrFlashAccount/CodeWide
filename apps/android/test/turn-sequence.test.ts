import type { RenderBlock } from "@codewide/renderers";
import { describe, expect, it } from "vitest";

import { activeTurnSequence, chronologicalTurnSequence, completedTurnContent } from "../src/rendering/turn-sequence";

function block(key: string, kind: RenderBlock["kind"], body: string | null = null): RenderBlock {
  return { key, kind, body, raw: {}, title: key, status: null, durationMs: null, tone: "neutral", collapsible: true } as RenderBlock;
}

describe("chronological turn sequence", () => {
  it("keeps collapsed activity ranges between visible progress messages", () => {
    const sequence = activeTurnSequence(
      [
        { index: 2, block: block("progress-1", "agentMessage", "First update") },
        { index: 4, block: block("tool-live", "commandExecution") },
        { index: 5, block: block("progress-2", "agentMessage", "Second update") },
      ],
      [1, 3],
    );

    expect(sequence.map((part) => part.kind === "collapsedActivity"
      ? `collapsed:${part.indexes.join(",")}`
      : part.kind === "agent"
        ? part.block.key
        : part.blocks.map((item) => item.key).join(",")))
      .toEqual(["collapsed:1", "progress-1", "collapsed:3", "tool-live", "progress-2"]);
  });

  it("keeps activity and agent messages in wire order", () => {
    const sequence = chronologicalTurnSequence([
      block("user", "userMessage"),
      block("tool-1", "commandExecution"),
      block("commentary", "agentMessage", "First update"),
      block("tool-2", "mcpToolCall"),
      block("final", "agentMessage", "Done"),
    ]);

    expect(sequence.map((part) => part.kind === "agent" ? part.block.key : part.blocks.map((item) => item.key).join(",")))
      .toEqual(["tool-1", "commentary", "tool-2", "final"]);
  });

  it("marks only activity already followed by an agent message for collapse", () => {
    const sequence = chronologicalTurnSequence([
      block("tool-1", "commandExecution"),
      block("commentary", "agentMessage", "Still working"),
      block("tool-2", "commandExecution"),
    ]);
    const activity = sequence.filter((part) => part.kind === "activity");

    expect(activity.map((part) => part.followedByAgent)).toEqual([true, false]);
  });

  it("ignores empty agent deltas without reordering activity", () => {
    const sequence = chronologicalTurnSequence([
      block("tool-1", "commandExecution"),
      block("empty", "agentMessage", "  "),
      block("tool-2", "commandExecution"),
    ]);

    expect(sequence).toHaveLength(1);
    expect(sequence[0]?.kind === "activity" ? sequence[0].blocks.map((item) => item.key) : []).toEqual(["tool-1", "tool-2"]);
  });

  it("keeps only the explicit final answer outside completed history", () => {
    const commentary = { ...block("commentary", "agentMessage", "Still working"), status: "commentary", raw: { phase: "commentary" } } as RenderBlock;
    const final = { ...block("final", "agentMessage", "Done"), status: "final_answer", raw: { phase: "final_answer" } } as RenderBlock;
    const content = completedTurnContent([
      block("user", "userMessage"),
      block("tool-1", "commandExecution"),
      commentary,
      block("tool-2", "mcpToolCall"),
      final,
      block("metadata", "turnDiff"),
    ]);

    expect(content.finalAnswer?.key).toBe("final");
    expect(content.history.map((item) => item.key)).toEqual(["tool-1", "commentary", "tool-2", "metadata"]);
  });

  it("falls back to the last non-empty agent message for legacy turns", () => {
    const content = completedTurnContent([
      block("first", "agentMessage", "First"),
      block("tool", "commandExecution"),
      block("last", "agentMessage", "Last"),
    ]);

    expect(content.finalAnswer?.key).toBe("last");
    expect(content.history.map((item) => item.key)).toEqual(["first", "tool"]);
  });
});
