import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bubble = readFileSync(new URL("../src/rendering/Bubble.tsx", import.meta.url), "utf8");
const markdown = readFileSync(new URL("../src/rendering/RichMarkdown.tsx", import.meta.url), "utf8");
const mermaidNative = readFileSync(new URL("../src/rendering/MermaidDiagram.native.tsx", import.meta.url), "utf8");
const mermaidWeb = readFileSync(new URL("../src/rendering/MermaidDiagram.web.tsx", import.meta.url), "utf8");
const screen = readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8");

describe("Yoga-owned bubble layout", () => {
  it("keeps bubble geometry declarative", () => {
    expect(bubble).not.toMatch(/measurePretextBubble|useMemo|PixelRatio|onLayout/u);
    expect(bubble).not.toMatch(/\bheight\s*:/u);
    expect(bubble).toContain('maxWidth: "88%"');
    expect(bubble).toContain('width: "88%"');
    expect(bubble).toContain('maxWidth: "82%"');
    expect(bubble).toContain('alignSelf: "flex-start"');
    expect(bubble).toContain('alignSelf: "flex-end"');
  });

  it("contains every bubble failure inside the shared bubble surface", () => {
    expect(bubble).toContain('scope="bubble"');
    expect(bubble).toContain('label={errorLabel ?? (variant === "agent" ? "Agent message" : "User message")}');
    expect(bubble).toContain('resetKey={errorResetKey ?? `${variant}:${testID ?? "bubble"}`}');
    expect(screen).toContain('errorResetKey={`${item.scope}:${item.id}`}');
    expect(screen).toContain('errorResetKey={`${turn.key}:user`}');
    expect(screen).toContain('errorResetKey={`${turn.key}:agent`}');
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
    expect(markdown).toContain("document: { minWidth: 0, gap: 5 }");
    expect(markdown).toContain("paragraph: { minWidth: 0, color:");
    expect(screen).toContain("userMessageContent: { minWidth: 0, gap: 6 }");
    expect(screen).toContain("userMessageBlock: { minWidth: 0 }");
    expect(screen).toContain("userMessageTextBlock: { minWidth: 0 }");
  });

  it("selects fill layout from Markdown structure without measuring text", () => {
    expect(screen).not.toContain("agentBubbleWidthPolicy");
    expect(screen).toContain("richMarkdownLayout");
    expect(screen).not.toContain('rawTurn.status === "inProgress"\n    || latestAgentBlock?.content?.fields["/text"]');
    expect(screen).not.toContain("measurementSource");
    expect(screen).toContain('variant="agent"');
    expect(screen).toContain('fill={agentBubbleFill}');
    expect(screen).toContain('testID="codex-bubble"');
    expect(screen).toContain('variant="user"');
    expect(screen).toContain('testID="user-bubble"');
  });

  it("fills only disclosed activity while keeping thinking intrinsically sized", () => {
    expect(screen).toContain("const hasDisclosedBubbleActivity = preTurnBlocks.some(preTurnBlockUsesDisclosure)");
    expect(screen).toContain("|| completedActivityCount > 0");
    expect(screen).toContain('part.kind === "collapsedActivity"');
    expect(screen).toContain('part.kind === "activity" && activitySegmentUsesDisclosure(part)');
    expect(screen).toContain('thinkingStatusSection: { minWidth: 0, maxWidth: "100%", alignSelf: "flex-start", alignItems: "flex-start" }');

    const turnStart = screen.indexOf("function TurnTimelineItem(");
    const agentBubbleStart = screen.indexOf('<Bubble\n            variant="agent"', turnStart);
    const agentBubbleEnd = screen.indexOf("</Bubble>", agentBubbleStart);
    const beforeAgentBubble = screen.slice(turnStart, agentBubbleStart);
    const agentBubble = screen.slice(agentBubbleStart, agentBubbleEnd);

    expect(beforeAgentBubble).toContain("blocks={compactionBlocks}");
    expect(beforeAgentBubble).not.toContain("blocks={preTurnBlocks}");
    expect(agentBubble).toContain("blocks={preTurnBlocks}");
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
    expect(screen).toContain('fill={richMarkdownLayout(part.block.body ?? "") === "fill"}');
    expect(screen).toContain("const documentStyle = [styles.agentMarkdownDocument, fill && styles.agentMarkdownDocumentFill]");
    expect(screen).toContain('agentMarkdownDocumentFill: { width: "100%", alignSelf: "stretch" }');
    expect(screen).toContain('(mode === "code" || fill) && styles.liveAgentResponseFill');
  });
});
