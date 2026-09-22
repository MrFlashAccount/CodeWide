import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { compactSource, sourceHasJsxElement, sourceObjectDeclaration } from "./source-contract";

const bubble = readFileSync(new URL("../src/rendering/Bubble.tsx", import.meta.url), "utf8");
const markdown = readFileSync(
  new URL("../src/rendering/RichMarkdown.tsx", import.meta.url),
  "utf8",
);
const mermaidNative = readFileSync(
  new URL("../src/rendering/MermaidDiagram.native.tsx", import.meta.url),
  "utf8",
);
const mermaidWeb = readFileSync(
  new URL("../src/rendering/MermaidDiagram.web.tsx", import.meta.url),
  "utf8",
);
const screen = compactSource(
  readFileSync(new URL("../app/(workspace)/_layout.tsx", import.meta.url), "utf8"),
);

const ownerOptimisticTurn = compactSource(
  readFileSync(
    new URL("../src/features/conversation/turns/OptimisticTurn.tsx", import.meta.url),
    "utf8",
  ),
);
const ownerTurnTimelineItem = compactSource(
  readFileSync(
    new URL("../src/features/conversation/turns/TurnTimelineItem.tsx", import.meta.url),
    "utf8",
  ),
);
const ownerTurnTimelineItemStyles = compactSource(
  readFileSync(
    new URL("../src/features/conversation/turns/TurnTimelineItem.styles.ts", import.meta.url),
    "utf8",
  ),
);
const ownerUserMessageContentStyles = compactSource(
  readFileSync(
    new URL("../src/features/conversation/turns/UserMessageContent.styles.ts", import.meta.url),
    "utf8",
  ),
);
const ownerTurnProjection = compactSource(
  readFileSync(
    new URL("../src/features/conversation/turns/turnProjection.ts", import.meta.url),
    "utf8",
  ),
);
const ownerAgentResponseMarkdown = compactSource(
  readFileSync(
    new URL("../src/features/conversation/content/AgentResponseMarkdown.tsx", import.meta.url),
    "utf8",
  ),
);
const ownerAgentResponseMarkdownStyles = compactSource(
  readFileSync(
    new URL(
      "../src/features/conversation/content/AgentResponseMarkdown.styles.ts",
      import.meta.url,
    ),
    "utf8",
  ),
);
const ownerLiveAgentResponse = compactSource(
  readFileSync(
    new URL("../src/features/conversation/turns/LiveAgentResponse.tsx", import.meta.url),
    "utf8",
  ),
);

const activityStyles = compactSource(
  readFileSync(
    new URL("../src/features/conversation/turns/TurnActivity.styles.ts", import.meta.url),
    "utf8",
  ),
);

const ownerUserTurnBody = compactSource(
  readFileSync(
    new URL("../src/features/conversation/turns/UserTurnBody.tsx", import.meta.url),
    "utf8",
  ),
);
const ownerAgentTurnBody = compactSource(
  readFileSync(
    new URL("../src/features/conversation/turns/AgentTurnBody.tsx", import.meta.url),
    "utf8",
  ),
);
const ownerVirtualizedAgentTurnBody = compactSource(
  readFileSync(
    new URL("../src/features/conversation/turns/VirtualizedAgentTurnBody.tsx", import.meta.url),
    "utf8",
  ),
);

describe("Yoga-owned bubble layout", () => {
  it("keeps bubble geometry declarative", () => {
    expect(bubble).not.toMatch(/measurePretextBubble|useMemo|PixelRatio|onLayout/u);
    expect(bubble).not.toMatch(/\bheight\s*:/u);
    expect(bubble).toContain('maxWidth: "100%"');
    expect(bubble).toContain("flexGrow: 1");
    expect(bubble).toContain("flexBasis: 0");
    expect(bubble).toContain('maxWidth: "82%"');
    expect(bubble).toContain('alignSelf: "flex-start"');
    expect(bubble).toContain('alignSelf: "flex-end"');
  });

  it("keeps the bubble bottom inset equal to its horizontal inset", () => {
    for (const surface of ["agentSurface", "userSurface"]) {
      const style = sourceObjectDeclaration(compactSource(bubble), surface);
      expect(style).toContain("paddingBottom: spacing.sm");
      expect(style).toContain("paddingHorizontal: spacing.sm");
    }
    expect(ownerUserMessageContentStyles).not.toContain("userMessageAttachmentContent");
  });

  it("left-aligns agent file attachments in both renderer modes", () => {
    expect(sourceObjectDeclaration(ownerTurnTimelineItemStyles, "agentAttachmentGrid")).toContain(
      'alignSelf: "flex-start"',
    );
    for (const owner of [ownerAgentTurnBody, ownerVirtualizedAgentTurnBody]) {
      expect(owner).toContain("<MessageAttachmentGrid style={styles.agentAttachmentGrid}>");
    }
  });

  it("contains every bubble failure inside the shared bubble surface", () => {
    expect(bubble).toContain('scope="bubble"');
    expect(bubble).toContain(
      'label={errorLabel ?? (variant === "agent" ? "Agent message" : "User message")}',
    );
    expect(bubble).toContain('resetKey={errorResetKey ?? `${variant}:${testID ?? "bubble"}`}');
    expect(ownerOptimisticTurn).toContain("errorResetKey={`${item.scope}:${item.id}`}");
    expect(ownerUserTurnBody).toContain("errorResetKey={`${turn.key}:user`}");
    expect(ownerTurnTimelineItem).toContain("errorResetKey={`${turn.key}:agent`}");
  });

  it("lets native Text wrap and size Markdown without a second text layout", () => {
    expect(markdown).not.toContain("expo-pretext");
    expect(markdown).not.toContain("PretextTextBlock");
    expect(markdown).not.toContain("materializePretextLines");
    expect(
      sourceHasJsxElement(markdown, "Text", [
        "selectable",
        "reviewBlockPath={path}",
        "style={styles.paragraph}",
      ]),
    ).toBe(true);
    expect(compactSource(markdown)).toContain("{inline(node.children)} </Text>");
  });

  it("keeps the intrinsic plain-text chain free of percentage width caps", () => {
    const surfaceStyle = sourceObjectDeclaration(bubble, "surface");
    expect(surfaceStyle).toContain("minWidth: 0");
    expect(surfaceStyle).toContain("borderRadius:");
    expect(bubble).toContain("content: { minWidth: 0 }");
    const documentStyle = sourceObjectDeclaration(markdown, "document");
    expect(documentStyle).toContain("minWidth: 0");
    expect(documentStyle).toContain("gap: spacing.xxs");
    const paragraphStyle = sourceObjectDeclaration(markdown, "paragraph");
    expect(paragraphStyle).toContain("minWidth: 0");
    expect(paragraphStyle).toContain("color: colors.text");
    const userMessageContentStyle = sourceObjectDeclaration(
      ownerUserMessageContentStyles,
      "userMessageContent",
    );
    expect(userMessageContentStyle).toContain("minWidth: 0");
    expect(userMessageContentStyle).toContain("gap: spacing.compact");
    expect(sourceObjectDeclaration(ownerTurnTimelineItemStyles, "userMessageBlock")).toContain(
      "minWidth: 0",
    );
    expect(
      sourceObjectDeclaration(ownerUserMessageContentStyles, "userMessageTextBlock"),
    ).toContain("minWidth: 0");
  });

  it("selects fill layout from Markdown structure without measuring text", () => {
    expect(screen).not.toContain("agentBubbleWidthPolicy");
    expect(ownerAgentTurnBody).toContain("richMarkdownLayout");
    expect(screen).not.toContain(
      'rawTurn.status === "inProgress"\n    || latestAgentBlock?.content?.fields["/text"]',
    );
    expect(screen).not.toContain("measurementSource");
    expect(ownerTurnTimelineItem).toContain('variant="agent"');
    expect(ownerTurnTimelineItem).toContain("fill={presentation.agentBubbleFill}");
    expect(ownerTurnTimelineItem).toContain('testID="codex-bubble"');
    expect(ownerUserTurnBody).toContain('variant="user"');
    expect(ownerUserTurnBody).toContain('testID="user-bubble"');
  });

  it("fills only disclosed activity while keeping thinking intrinsically sized", () => {
    expect(ownerTurnProjection).toContain(
      "const hasDisclosedBubbleActivity = preTurnBlocks.some(preTurnBlockUsesDisclosure)",
    );
    expect(ownerTurnProjection).toContain("|| completedActivityCount > 0");
    expect(ownerTurnProjection).toContain('part.kind === "collapsedActivity"');
    expect(ownerTurnProjection).toContain(
      'part.kind === "activity" && activitySegmentUsesDisclosure(part)',
    );
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
    expect(ownerTurnTimelineItem).toContain("renderAgentTurnBody(turn, presentation,");
    expect(ownerAgentTurnBody).toContain("blocks={presentation.preTurnBlocks}");
  });

  it("lets diagram blocks stretch the bubble without measured width overrides", () => {
    expect(markdown).toContain("<View style={styles.wideBlock}>");
    const wideBlockStyle = sourceObjectDeclaration(markdown, "wideBlock");
    expect(wideBlockStyle).toContain('width: "100%"');
    expect(wideBlockStyle).toContain("minWidth: 0");
    expect(wideBlockStyle).toContain('maxWidth: "100%"');
    expect(wideBlockStyle).toContain('alignSelf: "stretch"');
    expect(mermaidNative).not.toContain("useRichContentWidth");
    expect(mermaidNative).toContain("style={styles.inlineReveal}");
    for (const diagramStyle of [
      sourceObjectDeclaration(mermaidNative, "card"),
      sourceObjectDeclaration(mermaidWeb, "image"),
    ]) {
      expect(diagramStyle).toContain('width: "100%"');
      expect(diagramStyle).toContain("minWidth: 0");
      expect(diagramStyle).toContain('maxWidth: "100%"');
      expect(diagramStyle).toContain('alignSelf: "stretch"');
    }
  });

  it("stretches copyable code through completed and streaming Markdown wrappers", () => {
    expect(ownerAgentTurnBody).toContain(
      'fill={richMarkdownLayout(renderBlockBody(part.block)) === "fill"}',
    );
    expect(ownerAgentTurnBody).toContain('return block.body ?? "";');
    expect(ownerAgentResponseMarkdown).toContain(
      "const documentStyle = [styles.agentMarkdownDocument, fill && styles.agentMarkdownDocumentFill]",
    );
    const documentFillStyle = sourceObjectDeclaration(
      ownerAgentResponseMarkdownStyles,
      "agentMarkdownDocumentFill",
    );
    expect(documentFillStyle).toContain('width: "100%"');
    expect(documentFillStyle).toContain('alignSelf: "stretch"');
    expect(ownerLiveAgentResponse).toContain(
      '(mode === "code" || fill) && styles.liveAgentResponseFill',
    );
  });
});
