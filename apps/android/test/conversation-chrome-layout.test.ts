import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { controlSize, darkScheme, layoutSize, radii, spacing, colors } from "../src/theme";
import {
  conversationBottomContentInset,
  conversationChromeEdgeInset,
  conversationHeaderChromeHeight,
  conversationTopContentInset,
} from "../src/ui/conversation-chrome-layout";
import { compactSource, sourceObjectDeclaration } from "./source-contract";

const screen = compactSource(
  readFileSync(new URL("../app/v1/_layout.tsx", import.meta.url), "utf8"),
);
const panelUnderlay = readFileSync(
  new URL("../src/ui/ConversationPanelUnderlay.tsx", import.meta.url),
  "utf8",
);

const ownerConversationLayout = compactSource(
  readFileSync(
    new URL("../src/features/conversation/ConversationLayout.tsx", import.meta.url),
    "utf8",
  ),
);
const ownerTimelineViewport = compactSource(
  readFileSync(
    new URL("../src/features/conversation/timeline/timelineViewport.ts", import.meta.url),
    "utf8",
  ),
);
const ownerConversationBottomChrome = compactSource(
  readFileSync(
    new URL("../src/features/conversation/ConversationBottomChrome.tsx", import.meta.url),
    "utf8",
  ),
);

const composerInputStyles = compactSource(
  readFileSync(
    new URL("../src/features/composer/ComposerEditor.styles.ts", import.meta.url),
    "utf8",
  ),
);

const composerDockStyles = compactSource(
  readFileSync(
    new URL("../src/features/composer/ComposerFeature.styles.ts", import.meta.url),
    "utf8",
  ),
);

const composerStyles = compactSource(
  readFileSync(
    new URL("../src/features/composer/ComposerFeature.styles.ts", import.meta.url),
    "utf8",
  ),
);

const composerInputShellStyles = compactSource(
  readFileSync(
    new URL("../src/features/composer/ComposerFeature.styles.ts", import.meta.url),
    "utf8",
  ),
);

const composerStickyStyles = compactSource(
  readFileSync(
    new URL("../src/features/conversation/ConversationLayout.styles.ts", import.meta.url),
    "utf8",
  ),
);

const composerContextStripStyles = compactSource(
  readFileSync(
    new URL("../src/features/composer/ComposerContextStrip.styles.ts", import.meta.url),
    "utf8",
  ),
);

const composerContextChipStyles = compactSource(
  readFileSync(
    new URL("../src/features/composer/settings/ComposerControlChips.styles.ts", import.meta.url),
    "utf8",
  ),
);

const conversationHeaderStyles = compactSource(
  readFileSync(
    new URL("../src/features/conversation/header/ConversationHeader.styles.ts", import.meta.url),
    "utf8",
  ),
);

const conversationIdentityRaisedStyles = compactSource(
  readFileSync(
    new URL("../src/features/conversation/header/ConversationHeader.styles.ts", import.meta.url),
    "utf8",
  ),
);

const conversationRaisedStyles = compactSource(
  readFileSync(
    new URL("../src/features/conversation/ConversationLayout.styles.ts", import.meta.url),
    "utf8",
  ),
);

const timelineRead = compactSource(
  readFileSync(
    new URL("../src/features/conversation/timeline/conversationTimelineRead.ts", import.meta.url),
    "utf8",
  ),
);

const viewport = compactSource(
  readFileSync(
    new URL("../src/features/conversation/timeline/TimelineViewport.tsx", import.meta.url),
    "utf8",
  ),
);

describe("conversation chrome layout", () => {
  it("gives composer text and its native placeholder symmetric vertical insets", () => {
    const composerInput = sourceObjectDeclaration(composerInputStyles, "composerInput");
    expect(composerInput).toContain("paddingVertical: spacing.inputInset");
    expect(composerInput).not.toMatch(/paddingTop|paddingBottom/);
    expect(composerInput).toContain("minHeight: COMPOSER_MIN_HEIGHT");
    expect(composerInput).toContain("maxHeight: COMPOSER_MAX_HEIGHT");
  });

  it("does not paint transcript backdrops over loading, unpositioned or empty history", () => {
    // The composition contract applies to both opaque panels.
    expect(timelineRead).toContain(
      "timelinePositioned && conversationTimelineBinding.timeline.length > 0",
    );
    expect(
      ownerConversationLayout.match(
        /conversationBackdropVisible && \( <ConversationPanelUnderlay/g,
      ),
    ).toHaveLength(2);
  });
  it("reuses the existing neutral surfaces instead of inventing a palette", () => {
    expect(colors.threadListSurface).toBe(darkScheme.background);
    expect(colors.conversationSurface).toBe(darkScheme.surface);
    expect(colors.messageSurface).toBe(darkScheme.background);
  });

  it("reserves only the chrome that can cover the first and last message", () => {
    expect(conversationTopContentInset(false)).toBe(layoutSize.header + spacing.compact);
    expect(conversationTopContentInset(true)).toBe(
      conversationTopContentInset(false) + controlSize.regular + spacing.xxs,
    );
    expect(conversationBottomContentInset(96, false)).toBe(96);
    expect(conversationBottomContentInset(96, true)).toBe(96 + controlSize.touch + spacing.sm);
  });

  it("clips opaque surfaces to the complete top and bottom chrome", () => {
    expect(conversationHeaderChromeHeight(false)).toBe(layoutSize.header);
    expect(conversationHeaderChromeHeight(true)).toBe(
      layoutSize.header + controlSize.regular + spacing.xxs,
    );
    expect(ownerConversationLayout).toContain(
      "height: conversationHeaderChromeHeight(threadSearchVisible)",
    );
    expect(ownerConversationLayout).toContain(
      "<ConversationPanelUnderlay style={StyleSheet.absoluteFill} />",
    );
    expect(screen).not.toContain("height: bottomChromeHeight");
  });

  it("retains the measured composer height for transcript clearance, not backdrop layout", () => {
    expect(ownerTimelineViewport).toContain(
      "const [bottomChromeHeight, setBottomChromeHeight] = useState(0)",
    );
    expect(ownerConversationBottomChrome).toContain('testID="conversation-bottom-chrome"');
    expect(ownerConversationBottomChrome).toContain(
      "const nextHeight = Math.ceil(nativeEvent.layout.height)",
    );
    expect(ownerConversationBottomChrome).toContain(
      "Math.abs(current - nextHeight) < 1 ? current : nextHeight",
    );
    expect(screen).not.toContain("composerDockHeight");
    expect(viewport).toContain(
      "conversationBottomContentInset( props.bottomChromeHeight, props.liveStatusVisible, )",
    );

    const composerDock = sourceObjectDeclaration(composerDockStyles, "composerDock");
    const composer = sourceObjectDeclaration(composerStyles, "composer");
    const composerInputShell = sourceObjectDeclaration(
      composerInputShellStyles,
      "composerInputShell",
    );
    expect(composerDock).not.toMatch(/\bheight:/u);
    expect(composer).toContain("flexShrink: 0");
    expect(composerInputShell).not.toContain("maxHeight");
    expect(composerInputShell).toContain('overflow: "visible"');
  });

  it("uses opaque chrome surfaces without per-frame backdrop rendering", () => {
    expect(panelUnderlay).toContain("surfaceColor = colors.conversationSurface");
    expect(panelUnderlay).toContain("backgroundColor: surfaceColor");
    expect(panelUnderlay).toContain('pointerEvents="none"');
    expect(panelUnderlay).not.toContain("requireNativeComponent");
    expect(panelUnderlay).not.toContain("findNodeHandle");
    expect(panelUnderlay).not.toMatch(/blur/iu);
    expect(screen).not.toContain("BlurTargetView");
    expect(screen).not.toContain("ConversationPanelBlur");
    expect(screen).not.toContain('direction="down"');
    expect(screen).not.toContain('direction="up"');
  });

  it("keeps list chrome on the opaque thread-list surface", () => {
    const sidebarStyles = readFileSync(
      new URL("../src/features/threadList/ThreadSidebar.styles.ts", import.meta.url),
      "utf8",
    );
    const threadListHeader = sourceObjectDeclaration(
      compactSource(sidebarStyles),
      "threadListHeaderChrome",
    );
    expect(threadListHeader).toContain("flexShrink: 0");
    expect(threadListHeader).toContain("backgroundColor: colors.threadListSurface");
    expect(threadListHeader).not.toContain("position");
    expect(screen).not.toContain("threadListHeaderUnderlay");
    expect(screen).not.toContain("desktopHeaderChromeHeight");
    expect(screen).not.toContain("mobileHeaderChromeHeight");
  });

  it("overlays edge-to-edge chrome without a panel shadow", () => {
    const composerSticky = sourceObjectDeclaration(composerStickyStyles, "composerSticky");
    const composerDock = sourceObjectDeclaration(composerDockStyles, "composerDock");
    const composerContextStrip = sourceObjectDeclaration(
      composerContextStripStyles,
      "composerContextStrip",
    );
    const composerContextChip = sourceObjectDeclaration(
      composerContextChipStyles,
      "composerContextChip",
    );
    const composer = sourceObjectDeclaration(composerStyles, "composer");
    const composerInputShell = sourceObjectDeclaration(
      composerInputShellStyles,
      "composerInputShell",
    );
    const inlineQueueOverlay = readFileSync(
      new URL("../src/features/queue/InlineQueueOverlay.tsx", import.meta.url),
      "utf8",
    );
    const queueLayout = readFileSync(
      new URL("../src/features/queue/inlineQueueLayout.ts", import.meta.url),
      "utf8",
    );
    const queueStyles = readFileSync(
      new URL("../src/features/queue/InlineQueueOverlay.styles.ts", import.meta.url),
      "utf8",
    );
    const queueBubble = readFileSync(
      new URL("../src/features/queue/AnimatedQueueBubble.tsx", import.meta.url),
      "utf8",
    );
    const queueMotion = readFileSync(
      new URL("../src/features/queue/queueBubbleMotion.ts", import.meta.url),
      "utf8",
    );
    const conversationHeader = sourceObjectDeclaration(
      conversationHeaderStyles,
      "conversationHeader",
    );
    const conversationIdentityRaised = sourceObjectDeclaration(
      conversationIdentityRaisedStyles,
      "conversationIdentityRaised",
    );
    const raisedConversation = sourceObjectDeclaration(
      conversationRaisedStyles,
      "conversationRaised",
    );
    expect(composerSticky).toMatch(/position: "absolute"/);
    expect(composerSticky).toContain("bottom: -StyleSheet.hairlineWidth");
    expect(composerSticky).toMatch(/left: 0/);
    expect(composerSticky).toMatch(/right: 0/);
    expect(composerDock).not.toMatch(/elevation|shadow/);
    expect(composerDock).not.toContain("backgroundColor");
    expect(composerContextStrip).not.toContain("backgroundColor");
    expect(composer).not.toContain("backgroundColor");
    expect(composerContextChip).toContain("backgroundColor: colors.surfaceContainerHigh");
    expect(composerInputShell).toContain("backgroundColor: colors.surfaceContainerHigh");
    expect(composerInputShell).toContain("borderRadius: radii.composer");
    expect(composerInputShell).toContain('overflow: "visible"');
    expect(screen).not.toContain("composerInputSurface");
    expect(conversationChromeEdgeInset).toBe(spacing.compact);
    expect(composer).toContain("paddingHorizontal: conversationChromeEdgeInset");
    expect(composer).toContain("paddingBottom: spacing.compact");
    expect(queueLayout).toContain("const STACK_VISIBLE_ITEMS = 2");
    expect(inlineQueueOverlay).toContain('testID="inline-queue-tail"');
    expect(queueStyles).toContain('width: "82%"');
    expect(queueBubble).toContain(
      "expanded ? styles.expandedBubbleContent : styles.collapsedBubbleContent",
    );
    expect(queueMotion).toContain("withSpring(targetY, QUEUE_SPRING_GLIDE)");
    expect(inlineQueueOverlay).not.toContain("LinearTransition");
    expect(inlineQueueOverlay).not.toMatch(/elevation|shadow/u);
    expect(screen).not.toContain("InlineQueueStack");
    expect(screen).not.toContain("inlineQueueAnchor");
    expect(conversationHeader).toContain("paddingHorizontal: conversationChromeEdgeInset");
    expect(conversationHeader).not.toContain("backgroundColor");
    expect(conversationIdentityRaised).toContain("marginLeft: spacing.xs");
    expect(conversationIdentityRaised).toContain("translateY: spacing.optical");
    expect(raisedConversation).toContain("borderTopLeftRadius: radii.composer");
    expect(raisedConversation).toContain("borderBottomLeftRadius: radii.composer");
    expect(radii.composer).toBeGreaterThan(radii.medium);
  });
});
