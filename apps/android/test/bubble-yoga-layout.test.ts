import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { compactSource, sourceObjectDeclaration } from "./source-contract";

const bubble = readFileSync(new URL("../src/rendering/Bubble.tsx", import.meta.url), "utf8");
const markdown = readFileSync(new URL("../src/rendering/RichMarkdown.tsx", import.meta.url), "utf8");
const mermaidNative = readFileSync(new URL("../src/rendering/MermaidDiagram.native.tsx", import.meta.url), "utf8");
const mermaidWeb = readFileSync(new URL("../src/rendering/MermaidDiagram.web.tsx", import.meta.url), "utf8");
const screen = compactSource(readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8"));

const ownerOptimisticTurn = compactSource(readFileSync(new URL("../src/features/conversation/turns/OptimisticTurn.tsx", import.meta.url), "utf8"));
const ownerTurnTimelineItem = compactSource(readFileSync(new URL("../src/features/conversation/turns/TurnTimelineItem.tsx", import.meta.url), "utf8"));
const ownerTurnTimelineItemStyles = compactSource(readFileSync(new URL("../src/features/conversation/turns/TurnTimelineItem.styles.ts", import.meta.url), "utf8"));
const ownerUserMessageContentStyles = compactSource(readFileSync(new URL("../src/features/conversation/turns/UserMessageContent.styles.ts", import.meta.url), "utf8"));
const ownerTurnProjection = compactSource(readFileSync(new URL("../src/features/conversation/turns/turnProjection.ts", import.meta.url), "utf8"));
const ownerAgentResponseMarkdown = compactSource(readFileSync(new URL("../src/features/conversation/content/AgentResponseMarkdown.tsx", import.meta.url), "utf8"));
const ownerAgentResponseMarkdownStyles = compactSource(readFileSync(new URL("../src/features/conversation/content/AgentResponseMarkdown.styles.ts", import.meta.url), "utf8"));
const ownerLiveAgentResponse = compactSource(readFileSync(new URL("../src/features/conversation/turns/LiveAgentResponse.tsx", import.meta.url), "utf8"));

const activityStyles = compactSource(readFileSync(new URL("../src/features/conversation/turns/TurnActivity.styles.ts", import.meta.url), "utf8"));

const ownerUserTurnBody = compactSource(readFileSync(new URL("../src/features/conversation/turns/UserTurnBody.tsx", import.meta.url), "utf8"));
const ownerAgentTurnBody = compactSource(readFileSync(new URL("../src/features/conversation/turns/AgentTurnBody.tsx", import.meta.url), "utf8"));

describe("Yoga-owned bubble layout", () => {
  it("keeps bubble geometry declarative", () => {
    expect(bubble).not.toMatch(/measurePretextBubble|useMemo|PixelRatio|onLayout/u);
    expect(bubble).not.toMatch(/\bheight\s*:/u);
    expect(bubble).toContain('maxWidth: "100%"');
    expect(bubble).toContain('flexGrow: 1');
    expect(bubble).toContain('flexBasis: 0');
    expect(bubble).toContain('maxWidth: "82%"');
    expect(bubble).toContain('alignSelf: "flex-start"');
    expect(bubble).toContain('alignSelf: "flex-end"');
  });

  it("contains every bubble failure inside the shared bubble surface", () => {
    expect(bubble).toContain('scope="bubble"');
    expect(bubble).toContain('label={errorLabel ?? (variant === "agent" ? "Agent message" : "User message")}');
    expect(bubble).toContain('resetKey={errorResetKey ?? `${variant}:${testID ?? "bubble"}`}');
    expect(ownerOptimisticTurn).toContain('errorResetKey={`${item.scope}:${item.id}`}');
    expect(ownerUserTurnBody).toContain("errorResetKey={`${turn.key}:user`}");
    expect(ownerTurnTimelineItem).toContain('errorResetKey={`${turn.key}:agent`}');
  });

  it("lets native Text wrap and size Markdown without a second text layout", () => {
    expect(markdown).not.toContain("expo-pretext");
    expect(markdown).not.toContain("PretextTextBlock");
    expect(markdown).not.toContain("materializePretextLines");
    expect(markdown).toContain('<Text selectable reviewBlockPath={path} style={styles.paragraph}>{inline(node.children)}</Text>');
  });

  it("keeps the intrinsic plain-text chain free of percentage width caps", () => {
    expect(bubble).toContain("surface: {\n    minWidth: 0,\n    borderRadius:");
    expect(bubble).toContain("content: { minWidth: 0 }");
    expect(markdown).toContain("document: { minWidth: 0, gap: spacing.xxs }");
    expect(markdown).toContain("paragraph: { minWidth: 0, color:");
    expect(ownerUserMessageContentStyles).toContain("userMessageContent: { minWidth: 0, gap: spacing.compact }");
    expect(ownerTurnTimelineItemStyles).toContain("userMessageBlock: { minWidth: 0 }");
    expect(ownerUserMessageContentStyles).toContain("userMessageTextBlock: { minWidth: 0 }");
  });

  it("selects fill layout from Markdown structure without measuring text", () => {
    expect(screen).not.toContain("agentBubbleWidthPolicy");
    expect(ownerAgentTurnBody).toContain("richMarkdownLayout");
    expect(screen).not.toContain('rawTurn.status === "inProgress"\n    || latestAgentBlock?.content?.fields["/text"]');
    expect(screen).not.toContain("measurementSource");
    expect(ownerTurnTimelineItem).toContain('variant="agent"');
    expect(ownerTurnTimelineItem).toContain("fill={presentation.agentBubbleFill}");
    expect(ownerTurnTimelineItem).toContain('testID="codex-bubble"');
    expect(ownerUserTurnBody).toContain("variant=\"user\"");
    expect(ownerUserTurnBody).toContain("testID=\"user-bubble\"");
  });

  it("fills only disclosed activity while keeping thinking intrinsically sized", () => {
    expect(ownerTurnProjection).toContain("const hasDisclosedBubbleActivity = preTurnBlocks.some(preTurnBlockUsesDisclosure)");
    expect(ownerTurnProjection).toContain("|| completedActivityCount > 0");
    expect(ownerTurnProjection).toContain('part.kind === "collapsedActivity"');
    expect(ownerTurnProjection).toContain('part.kind === "activity" && activitySegmentUsesDisclosure(part)');
    const thinkingStatusSection = sourceObjectDeclaration(activityStyles, "thinkingStatusSection");
    expect(thinkingStatusSection).toContain('maxWidth: "100%"');
    expect(thinkingStatusSection).toContain('alignSelf: "flex-start"');
    expect(thinkingStatusSection).toContain('alignItems: "flex-start"');

    const turnStart = ownerTurnTimelineItem.indexOf("function TurnTimelineItem(");
    const agentBubbleStart = ownerTurnTimelineItem.indexOf('<Bubble variant="agent"', turnStart);
    const agentBubbleEnd = ownerTurnTimelineItem.indexOf("</Bubble>", agentBubbleStart);
    const beforeAgentBubble = ownerTurnTimelineItem.slice(turnStart, agentBubbleStart);
    const agentBubble = ownerTurnTimelineItem.slice(agentBubbleStart, agentBubbleEnd);

    expect(beforeAgentBubble).toContain("blocks={presentation.compactionBlocks}");
    expect(beforeAgentBubble).not.toContain("blocks={presentation.preTurnBlocks}");
    expect(agentBubble).toContain("renderAgentTurnBody(turn, presentation,");
    expect(ownerAgentTurnBody).toContain("blocks={presentation.preTurnBlocks}");
  });

  it("lets diagram blocks stretch the bubble without measured width overrides", () => {
    expect(markdown).toContain('<View style={styles.wideBlock}>');
    expect(markdown).toContain('wideBlock: { width: "100%", minWidth: 0, maxWidth: "100%", alignSelf: "stretch" }');
    expect(mermaidNative).not.toContain("useRichContentWidth");
    expect(mermaidNative).toContain('style={styles.inlineReveal}');
    expect(mermaidNative).toContain('card: { width: "100%", minWidth: 0, maxWidth: "100%", alignSelf: "stretch"');
    expect(mermaidWeb).toContain('image: { width: "100%", minWidth: 0, maxWidth: "100%", alignSelf: "stretch"');
  });

  it("stretches copyable code through completed and streaming Markdown wrappers", () => {
    expect(ownerAgentTurnBody).toContain("fill={richMarkdownLayout(part.block.body ?? \"\") === \"fill\"}");
    expect(ownerAgentResponseMarkdown).toContain("const documentStyle = [styles.agentMarkdownDocument, fill && styles.agentMarkdownDocumentFill]");
    expect(ownerAgentResponseMarkdownStyles).toContain('agentMarkdownDocumentFill: { width: "100%", alignSelf: "stretch" }');
    expect(ownerLiveAgentResponse).toContain('(mode === "code" || fill) && styles.liveAgentResponseFill');
  });
});
