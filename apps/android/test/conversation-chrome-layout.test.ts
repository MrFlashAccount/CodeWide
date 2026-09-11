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

const screen = compactSource(readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8"));
const panelUnderlay = readFileSync(
  new URL("../src/ui/ConversationPanelUnderlay.tsx", import.meta.url),
  "utf8",
);

describe("conversation chrome layout", () => {
  it("gives composer text and its native placeholder symmetric vertical insets", () => {
    const composerInput = styleDeclaration("composerInput");
    expect(composerInput).toContain("paddingVertical: spacing.inputInset");
    expect(composerInput).not.toMatch(/paddingTop|paddingBottom/);
    expect(composerInput).toContain("minHeight: COMPOSER_MIN_HEIGHT");
    expect(composerInput).toContain("maxHeight: COMPOSER_MAX_HEIGHT");
  });

  it("does not paint transcript backdrops over loading, unpositioned or empty history", () => {
    // The composition contract applies to both opaque panels.
    expect(screen).toContain("const conversationBackdropVisible = timelinePositioned && timeline.length > 0");
    expect(screen.match(/conversationBackdropVisible && \( <ConversationPanelUnderlay/g)).toHaveLength(2);
  });
  it("reuses the existing neutral surfaces instead of inventing a palette", () => {
    expect(colors.threadListSurface).toBe(darkScheme.background);
    expect(colors.conversationSurface).toBe(darkScheme.surface);
    expect(colors.messageSurface).toBe(darkScheme.background);
  });

  it("reserves only the chrome that can cover the first and last message", () => {
    expect(conversationTopContentInset(false)).toBe(
      layoutSize.header + spacing.compact,
    );
    expect(conversationTopContentInset(true)).toBe(
      conversationTopContentInset(false) + controlSize.regular + spacing.xxs,
    );
    expect(conversationBottomContentInset(96, false)).toBe(96);
    expect(conversationBottomContentInset(96, true)).toBe(
      96 + controlSize.touch + spacing.sm,
    );
  });

  it("clips opaque surfaces to the complete top and bottom chrome", () => {
    expect(conversationHeaderChromeHeight(false)).toBe(layoutSize.header);
    expect(conversationHeaderChromeHeight(true)).toBe(
      layoutSize.header + controlSize.regular + spacing.xxs,
    );
    expect(screen).toContain("height: conversationHeaderChromeHeight(threadSearchVisible)");
    expect(screen).toContain("<ConversationPanelUnderlay style={StyleSheet.absoluteFill} />");
    expect(screen).not.toContain("height: bottomChromeHeight");
  });

  it("retains the measured composer height for transcript clearance, not backdrop layout", () => {
    expect(screen).toContain("const [bottomChromeHeight, setBottomChromeHeight] = useState(0)");
    expect(screen).toContain('testID="conversation-bottom-chrome"');
    expect(screen).toContain("const nextHeight = Math.ceil(nativeEvent.layout.height)");
    expect(screen).toContain("Math.abs(current - nextHeight) < 1 ? current : nextHeight");
    expect(screen).not.toContain("composerDockHeight");
    expect(screen).toContain("conversationBottomContentInset( bottomChromeHeight,");

    const composerDock = styleDeclaration("composerDock");
    const composer = styleDeclaration("composer");
    const composerInputShell = styleDeclaration("composerInputShell");
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
    const threadListHeader = styleDeclaration("threadListHeaderChrome");
    expect(threadListHeader).toContain("flexShrink: 0");
    expect(threadListHeader).toContain("backgroundColor: colors.threadListSurface");
    expect(threadListHeader).not.toContain("position");
    expect(screen).not.toContain("threadListHeaderUnderlay");
    expect(screen).not.toContain("desktopHeaderChromeHeight");
    expect(screen).not.toContain("mobileHeaderChromeHeight");
  });

  it("overlays edge-to-edge chrome without a panel shadow", () => {
    const composerSticky = styleDeclaration("composerSticky");
    const composerDock = styleDeclaration("composerDock");
    const composerContextStrip = styleDeclaration("composerContextStrip");
    const composerContextChip = styleDeclaration("composerContextChip");
    const composer = styleDeclaration("composer");
    const composerInputShell = styleDeclaration("composerInputShell");
    const inlineQueueOverlay = readFileSync(new URL("../src/ui/InlineQueueOverlay.tsx", import.meta.url), "utf8");
    const conversationHeader = styleDeclaration("conversationHeader");
    const conversationIdentityRaised = styleDeclaration("conversationIdentityRaised");
    const raisedConversation = multilineStyleDeclaration("conversationRaised");
    expect(composerSticky).toMatch(/position: "absolute"/);
    expect(composerSticky).toMatch(/bottom: 0/);
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
    expect(inlineQueueOverlay).toContain("const STACK_VISIBLE_ITEMS = 2");
    expect(inlineQueueOverlay).toContain('testID="inline-queue-tail"');
    expect(inlineQueueOverlay).toContain('width: "82%"');
    expect(inlineQueueOverlay).toContain("expanded ? styles.expandedBubbleContent : styles.collapsedBubbleContent");
    expect(inlineQueueOverlay).toContain("withSpring(targetY, QUEUE_SPRING_GLIDE)");
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

function styleDeclaration(name: string): string {
  return sourceObjectDeclaration(screen, name);
}

function multilineStyleDeclaration(name: string): string {
  const start = screen.indexOf(`${name}: {`);
  if (start < 0) return "";
  return screen.slice(start, screen.indexOf("},", start) + 2);
}
