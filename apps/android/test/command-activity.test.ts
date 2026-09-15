import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { activityOutputFootprint, commandActivityInput, commandActivityTitle, commandOutputFootprint, estimatedOutputInputCostUsd } from "../src/rendering/command-activity";
import { compactSource, sourceObjectDeclaration } from "./source-contract";

const screen = compactSource(readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8"));

const ownerProtocolBlock = compactSource(readFileSync(new URL("../src/features/conversation/protocol/ProtocolBlock.tsx", import.meta.url), "utf8"));

const turnOwner = compactSource(readFileSync(new URL("../src/features/conversation/turns/TurnTimelineItem.tsx", import.meta.url), "utf8"));

const pendingOwner = compactSource(readFileSync(new URL("../src/features/conversation/turns/OptimisticTurn.tsx", import.meta.url), "utf8"));

const commandOwner = compactSource(readFileSync(new URL("../src/features/conversation/protocol/CommandOutput.tsx", import.meta.url), "utf8"));

const cardOwner = compactSource(readFileSync(new URL("../src/features/conversation/turns/Card.tsx", import.meta.url), "utf8"));

const unknownOwner = compactSource(readFileSync(new URL("../src/features/conversation/protocol/UnknownProtocolBlock.tsx", import.meta.url), "utf8"));

const usageOwner = compactSource(readFileSync(new URL("../src/features/conversation/protocol/TokenUsageProtocolBlock.tsx", import.meta.url), "utf8"));

const subagentOwner = compactSource(readFileSync(new URL("../src/features/conversation/protocol/AgentActivityProtocolBlock.tsx", import.meta.url), "utf8"));

const footerOwner = compactSource(readFileSync(new URL("../src/features/conversation/turns/TurnFooter.tsx", import.meta.url), "utf8"));

const cardStyles = compactSource(readFileSync(new URL("../src/features/conversation/turns/Card.styles.ts", import.meta.url), "utf8"));

const bubbleNestedSurfaceStyles = compactSource(readFileSync(new URL("../src/features/conversation/turns/Card.styles.ts", import.meta.url), "utf8"));

const thinkingStatusStyles = compactSource(readFileSync(new URL("../src/features/conversation/protocol/ProtocolBlock.styles.ts", import.meta.url), "utf8"));

const codeBlockStyles = compactSource(readFileSync(new URL("../src/rendering/NativeCodeBlock.tsx", import.meta.url), "utf8"));

const diffFileStyles = compactSource(readFileSync(new URL("../src/features/conversation/protocol/FileChangeProtocolBlock.styles.ts", import.meta.url), "utf8"));

const attachmentChipStyles = compactSource(readFileSync(new URL("../src/features/conversation/turns/UserMessageContent.styles.ts", import.meta.url), "utf8"));

const approvalCardStyles = compactSource(readFileSync(new URL("../src/features/requests/RequestFeature.styles.ts", import.meta.url), "utf8"));

const agentTurnBody = readFileSync(new URL("../src/features/conversation/turns/AgentTurnBody.tsx", import.meta.url), "utf8");

describe("command activity presentation", () => {
  it("gives an empty authoritative running turn a Thinking bubble, not a floating footer", () => {
    const turn = turnOwner;
    expect(turn).not.toContain("showAgentBubble");
    expect(agentTurnBody).toMatch(/!presentation\.hasAgentContent && \(?presentation\.rawTurn\.status === "inProgress"\)? &&/u);
    expect(agentTurnBody).toContain('testID="turn-thinking-placeholder"');
    expect(agentTurnBody).toContain('text="Thinking"');
    const agentBubble = turn.slice(turn.indexOf('<Bubble variant="agent"'), turn.lastIndexOf("</Bubble>"));
    expect(agentBubble).toContain("footer={ <TurnFooter");
    expect(agentBubble).toContain("renderAgentTurnBody(turn, presentation,");
    const pending = pendingOwner;
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
    const commandBlock = commandOwner;

    expect(ownerProtocolBlock).toContain('if (block.kind === "commandExecution") return ( <CommandExecutionProtocolBlock');
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
    const card = cardOwner;
    const unknown = unknownOwner;
    const usage = usageOwner;
    const subagent = subagentOwner;
    const cardStyle = sourceObjectDeclaration(cardStyles, "card");
    const nestedStyle = sourceObjectDeclaration(bubbleNestedSurfaceStyles, "bubbleNestedSurface");
    expect(card).toContain("useInsideBubbleSurface()");
    expect(card).toContain("insideBubbleSurface && styles.bubbleNestedSurface");
    for (const surface of [unknown, usage, subagent]) {
      expect(surface).toContain("useInsideBubbleSurface()");
      expect(surface).toContain("insideBubbleSurface && styles.bubbleNestedSurface");
    }
    expect(cardStyle).toContain("backgroundColor: colors.surfaceContainerLow");
    expect(nestedStyle).toContain('backgroundColor: "transparent"');
    expect(sourceObjectDeclaration(thinkingStatusStyles, "thinkingStatus")).not.toContain("backgroundColor");
    expect(sourceObjectDeclaration(codeBlockStyles, "fallbackViewport")).toContain("backgroundColor: colors.code");
    expect(sourceObjectDeclaration(diffFileStyles, "diffFile")).toContain("backgroundColor: colors.code");
    expect(sourceObjectDeclaration(attachmentChipStyles, "attachmentChip")).toContain("backgroundColor: colors.surfaceRaised");
    expect(sourceObjectDeclaration(approvalCardStyles, "approvalCard")).toContain("backgroundColor: colors.warningContainer");
  });

  it("keeps activity tokens and cost on one text baseline", () => {
    const metric = commandOwner.slice(commandOwner.indexOf("function OutputFootprintMetric"));

    expect(metric).toContain("const value = `≈${TOKEN_SYMBOL}");
    expect(compactSource(metric)).toContain("<Text numberOfLines={1} style={styles.outputFootprintMetricText}> {value} </Text>");
    expect(metric.match(/outputFootprintMetricText/g)).toHaveLength(1);
  });

  it("shows one token symbol before input and output counts in the turn footer", () => {
    const footer = footerOwner;

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
