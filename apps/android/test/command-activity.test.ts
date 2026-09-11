import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { activityOutputFootprint, commandActivityInput, commandActivityTitle, commandOutputFootprint, estimatedOutputInputCostUsd } from "../src/rendering/command-activity";
import { compactSource, sourceObjectDeclaration } from "./source-contract";

const screen = compactSource(readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8"));

describe("command activity presentation", () => {
  it("gives an empty authoritative running turn a Thinking bubble, not a floating footer", () => {
    const turn = screen.slice(screen.indexOf("function TurnTimelineItem"), screen.indexOf("type LiveContentMode"));
    expect(turn).not.toContain("showAgentBubble");
    expect(turn).toMatch(/!hasAgentContent && \(?rawTurn\.status === "inProgress"\)? &&/u);
    expect(turn).toContain('testID="turn-thinking-placeholder"');
    expect(turn).toContain('text="Thinking"');
    const agentBubble = turn.slice(turn.indexOf('<Bubble variant="agent"'), turn.lastIndexOf("</Bubble>"));
    expect(agentBubble).toContain("footer={ <TurnFooter");
    expect(agentBubble).toContain('testID="turn-thinking-placeholder"');
    const pending = screen.slice(screen.indexOf("function OptimisticTurn"), screen.indexOf("type CachedTurnProjection"));
    expect(pending).not.toContain("<TurnFooter");
    expect(pending).not.toContain("turn-thinking-placeholder");
    expect(pending).not.toContain('testID="optimistic-turn-footer-spacer"');
  });

  it("preserves the exact command for display and copy while bounding only its header", () => {
    const command = `fish -lc '${"long argument ".repeat(20)}'`;
    expect(commandActivityInput({ command }, "fallback")).toBe(command);
    expect(commandActivityTitle(command)).toHaveLength(120);
    expect(commandActivityTitle(command)).toMatch(/…$/u);
    expect(commandActivityInput({}, "fallback")).toBe("fallback");
  });

  it("renders command input and output as separately copyable sections", () => {
    const start = screen.indexOf("function CommandExecutionProtocolBlock");
    const end = screen.indexOf("const CONTENT_VIEW_CHUNK_BYTES", start);
    const commandBlock = screen.slice(start, end);

    expect(screen).toContain('if (block.kind === "commandExecution") return ( <CommandExecutionProtocolBlock');
    expect(commandBlock).toContain(">Input</Text>");
    expect(commandBlock).toContain('<CopyButton text={command} compact />');
    expect(commandBlock).toContain('language="shellscript"');
    expect(commandBlock).toContain('truncate={false}');
    expect(commandBlock).toContain(">Output</Text>");
    expect(commandBlock).toContain('<CopyButton text={body} compact />');
    expect(commandBlock).toContain('codeVariant="terminal"');
    expect(commandBlock).toContain("<LargeContentControls block={block}");
    expect(commandBlock).toContain("headerMeta={<OutputFootprintMetric");
    expect(commandBlock).toContain("initiallyExpanded={false}");
    expect(commandBlock).not.toContain("initiallyExpanded={running}");
  });

  it("keeps generic protocol surfaces transparent only when nested in a message bubble", () => {
    const card = screen.slice(screen.indexOf("function Card("), screen.indexOf("function usePersistentExpansion"));
    const unknown = screen.slice(screen.indexOf("function UnknownProtocolBlock"), screen.indexOf("function TokenUsageProtocolBlock"));
    const usage = screen.slice(screen.indexOf("function TokenUsageProtocolBlock"), screen.indexOf("function OpenableImage"));
    const subagent = screen.slice(screen.indexOf("function AgentActivityProtocolBlock"), screen.indexOf("function subagentActivityLabel"));
    const cardStyle = styleDeclaration("card");
    const nestedStyle = styleDeclaration("bubbleNestedSurface");
    expect(card).toContain("useInsideBubbleSurface()");
    expect(card).toContain("insideBubbleSurface && styles.bubbleNestedSurface");
    for (const surface of [unknown, usage, subagent]) {
      expect(surface).toContain("useInsideBubbleSurface()");
      expect(surface).toContain("insideBubbleSurface && styles.bubbleNestedSurface");
    }
    expect(cardStyle).toContain("backgroundColor: colors.surfaceContainerLow");
    expect(nestedStyle).toContain('backgroundColor: "transparent"');
    expect(styleDeclaration("thinkingStatus")).not.toContain("backgroundColor");
    expect(styleDeclaration("codeBlock")).toContain("backgroundColor: colors.code");
    expect(styleDeclaration("diffFile")).toContain("backgroundColor: colors.code");
    expect(styleDeclaration("attachmentChip")).toContain("backgroundColor: colors.surfaceRaised");
    expect(styleDeclaration("approvalCard")).toContain("backgroundColor: colors.warningContainer");
  });

  it("keeps activity tokens and cost on one text baseline", () => {
    const start = screen.indexOf("function OutputFootprintMetric");
    const end = screen.indexOf("const CONTENT_VIEW_CHUNK_BYTES", start);
    const metric = screen.slice(start, end);

    expect(metric).toContain("const value = `≈${TOKEN_SYMBOL}");
    expect(compactSource(metric)).toContain("<Text numberOfLines={1} style={styles.outputFootprintMetricText}> {value} </Text>");
    expect(metric.match(/outputFootprintMetricText/g)).toHaveLength(1);
  });

  it("shows one token symbol before input and output counts in the turn footer", () => {
    const start = screen.indexOf("function TurnFooter");
    const end = screen.indexOf("function CalmSpinner", start);
    const footer = screen.slice(start, end);

    expect(footer.match(/\{TOKEN_SYMBOL\}/g)).toHaveLength(1);
    expect(footer).toContain('prefix="↓"');
    expect(footer).toContain('prefix="↑"');
    expect(footer).toContain('style={styles.turnTokenMetrics}');
  });

  it("prefers companion attribution and falls back to the visible UTF-8 output", () => {
    expect(commandOutputFootprint({
      codewideOutputFootprint: {
        version: 1,
        basis: "approxBytesPerToken",
        bytes: 400,
        estimatedTokens: 100,
      },
    }, "short preview")).toEqual({
      version: 1,
      basis: "approxBytesPerToken",
      bytes: 400,
      estimatedTokens: 100,
    });
    expect(commandOutputFootprint({}, "λa")).toEqual({
      version: 1,
      basis: "approxBytesPerToken",
      bytes: 3,
      estimatedTokens: 1,
    });
  });

  it("aggregates command output and prices it as API-equivalent input", () => {
    const footprint = activityOutputFootprint([
      { raw: {}, visibleOutput: "1234" },
      { raw: {}, visibleOutput: "12345678" },
    ]);
    expect(footprint).toEqual({
      version: 1,
      basis: "approxBytesPerToken",
      bytes: 12,
      estimatedTokens: 3,
    });
    expect(estimatedOutputInputCostUsd(footprint, {
      version: 1,
      status: "final",
      modelContextWindow: null,
      latestRequest: { totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 },
      turn: {
        tokens: { totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 },
        cost: {
          model: "gpt-5.6",
          pricingVersion: "test",
          currency: "USD",
          basis: "apiEquivalent",
          price: { input: 5, cachedInput: 0.5, output: 30 },
          uncachedInputTokens: 0,
          cachedInputTokens: 0,
          cacheWriteInputTokens: 0,
          outputTokens: 0,
          cacheHitPercent: 0,
          uncachedInputCostUsd: 0,
          cachedInputCostUsd: 0,
          cacheWriteInputCostUsd: 0,
          outputCostUsd: 0,
          totalCostUsd: 0,
        },
      },
      thread: {
        tokens: { totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 },
        cost: null,
      },
    })).toBe(0.000015);
  });
});

function styleDeclaration(name: string): string {
  return sourceObjectDeclaration(screen, name);
}
