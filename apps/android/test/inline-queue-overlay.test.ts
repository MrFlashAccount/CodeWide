import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { compactSource, sourceObjectDeclaration } from "./source-contract";

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const screen = compactSource(readSource("../src/CodeWideScreen.tsx"));
const overlay = readSource("../src/features/queue/InlineQueueOverlay.tsx");
const layout = readSource("../src/features/queue/inlineQueueLayout.ts");
const motionPolicy = readSource("../src/features/queue/queueMotionPolicy.ts");
const motion = readSource("../src/features/queue/queueBubbleMotion.ts");
const bubble = readSource("../src/features/queue/AnimatedQueueBubble.tsx");
const state = readSource("../src/features/queue/inlineQueueState.ts");
const styles = readSource("../src/features/queue/InlineQueueOverlay.styles.ts");
const workspace = readSource("../src/data/command-delivery.ts");

const ownerConversationQueueFooter = compactSource(
  readFileSync(
    new URL("../src/features/conversation/ConversationQueueFooter.tsx", import.meta.url),
    "utf8",
  ),
);
const ownerTimelineViewport = compactSource(
  readFileSync(
    new URL("../src/features/conversation/timeline/TimelineViewport.tsx", import.meta.url),
    "utf8",
  ),
);

const footer = compactSource(
  readFileSync(
    new URL("../src/features/conversation/ConversationQueueFooter.tsx", import.meta.url),
    "utf8",
  ),
);

const ownerInlineQueueItem = readFileSync(
  new URL("../src/features/queue/InlineQueueItem.tsx", import.meta.url),
  "utf8",
);

const queueItem = compactSource(
  readFileSync(new URL("../src/features/queue/InlineQueueItem.tsx", import.meta.url), "utf8"),
);

describe("inline queue overlay", () => {
  it("springs one measured set of cards from a two-layer stack into the floating list", () => {
    expect(ownerConversationQueueFooter).toContain("<InlineQueueOverlay");
    expect(ownerConversationQueueFooter).toContain("onOpen={toggleInlineQueueOverlay}");
    expect(ownerConversationQueueFooter).toContain("expanded={inlineQueueExpanded}");
    expect(screen).not.toContain("InlineQueueStack");
    expect(overlay).toContain('testID="inline-queue-tail"');
    expect(overlay).toContain('testID="inline-queue-list"');
    expect(overlay).toContain("<ScrollView");
    expect(layout).toContain("const STACK_VISIBLE_ITEMS = 2");
    expect(bubble).toContain(
      "expanded ? styles.expandedBubbleContent : styles.collapsedBubbleContent",
    );
    expect(state).toContain("calculateQueueLayouts(items, measuredHeights, expanded)");
    expect(motion).toContain("layoutY.set(withSpring(targetY, QUEUE_SPRING_GLIDE))");
    expect(overlay).not.toContain("withDelay(delay");
    expect(layout).toContain("targetScale: expanded ? 1 : Math.max(0.9, 1 - index * 0.05)");
    expect(layout).toContain("targetOpacity: expanded || index < STACK_VISIBLE_ITEMS ? 1 : 0");
    expect(bubble).toContain("onMeasure(event.nativeEvent.layout.height + CARD_BORDER_WIDTH * 2)");
    expect(motion).toContain("animatedHeight.set(withSpring(measuredHeight, QUEUE_SPRING_GLIDE))");
    expect(motion).toContain("height: animatedHeight.get()");
    expect(motionPolicy).toContain("const SWIPE_EASING = Easing.bezier(0.22, 0.82, 0.18, 1)");
    expect(overlay).not.toContain("LinearTransition");
    expect(overlay).not.toContain("rotateX");
    expect(overlay).not.toContain("perspective");
    expect(ownerInlineQueueItem).toContain("!props.expanded && index === 0");
    expect(ownerInlineQueueItem).toMatch(
      /<Text numberOfLines=\{1\} ellipsizeMode="tail" style=\{styles\.stackLine\}>[\s\S]*styles\.stackTitle[\s\S]*styles\.stackPreview[\s\S]*<\/Text>/u,
    );
    expect(sourceObjectDeclaration(styles, "contentRow")).toContain('alignItems: "center"');
    expect(overlay).not.toContain("styles.headerBubble");
    expect(overlay).not.toContain('name="close"');
    expect(overlay).not.toContain("AppSheet");
    expect(overlay).not.toMatch(/elevation|shadow/u);
  });

  it("supports swipe actions and drag reorder without reorder menu buttons", () => {
    expect(ownerInlineQueueItem).toContain("<Text style={styles.retryText}>Retry</Text>");
    expect(ownerInlineQueueItem).toContain("<Text style={styles.actionText}>Steer</Text>");
    expect(motion).toContain('withTestId("queued-prompt-swipe")');
    expect(motion).toContain('withTestId("queued-prompt-reorder")');
    expect(motion).toContain("activateAfterLongPress(240)");
    expect(bubble).toContain("Gesture.Race(reorderGesture, swipeGesture)");
    expect(bubble).toContain(
      'pointerEvents={expanded ? "box-none" : index === 0 ? "auto" : "none"}',
    );
    expect(motion).toContain("expanded ? 1 : itemCount - index");
    expect(ownerInlineQueueItem).toContain(
      "raised={props.expanded && overlay.openMenuId === item.id}",
    );
    expect(ownerInlineQueueItem).toContain(
      "onOpenChange={(open) =>\n                overlay.setOpenMenuId",
    );
    expect(bubble).toContain("<Text style={styles.swipeActionText}>Delete</Text>");
    expect(bubble).toContain(
      "<Text style={[styles.swipeActionText, styles.steerSwipeActionText]}>Steer</Text>",
    );
    expect(queueItem).toContain('name="ellipsis-vertical"');
    expect(overlay).not.toContain('name="ellipsis-horizontal"');
    expect(bubble).toContain('name="navigate-outline" role="label" color={colors.onPrimary}');
    expect(motion).toContain("rawTranslation >= 8 && steerEnabled");
    expect(ownerInlineQueueItem).toContain(
      "swipeDismissDistance={overlay.viewportWidth + spacing.md}",
    );
    expect(motion).toContain("dismissOpacity.set(withDelay(170, withTiming(0");
    expect(queueItem).toContain("<ActionMenu");
    expect(ownerInlineQueueItem).toContain('accessibilityLabel="Queued prompt actions"');
    expect(queueItem).toContain('label: "Edit"');
    expect(ownerInlineQueueItem).toContain('label: "Delete"');
    expect(overlay).not.toContain('label: "Up in queue"');
    expect(overlay).not.toContain('label: "Down in queue"');
    expect(overlay).not.toContain("<Text style={styles.actionText}>Edit</Text>");
    expect(overlay).not.toContain('accessibilityLabel="Move queued prompt earlier"');
    expect(ownerInlineQueueItem).toContain("numberOfLines={props.expanded ? 2 : 1}");
    expect(styles).toContain("left: 0");
    expect(styles).toContain("right: 0");
    expect(styles).toContain("width: SWIPE_REVEAL");
  });

  it("matches message-bubble geometry and formats time from device preferences", () => {
    expect(layout).toContain('import { formatDeviceTime } from "../../data/device-time"');
    expect(layout).toContain("formatDeviceTime(createdAtMilliseconds / 1_000)");
    expect(overlay).not.toContain("toLocaleTimeString");
    expect(styles).toContain("borderRadius: radii.selected");
    expect(styles).toContain("paddingHorizontal: spacing.sm");
    expect(styles).toContain("paddingVertical: spacing.xs");
  });

  it("renders at the timeline tail without adding queue height to the composer", () => {
    expect(footer).toContain(
      "!queuedPromptEditing && !threadSearchActive && inlineQueueOverlayItems.length > 0",
    );
    expect(ownerConversationQueueFooter).toContain("maxHeight={inlineQueueMaxHeight}");
    expect(screen).not.toContain("inlineQueueAnchor");
    expect(screen).not.toContain("measureInlineQueueOverlayAnchor");
    expect(styles).toContain('width: "82%"');
    expect(styles).toContain('position: "absolute"');
    expect(styles).toContain("minHeight: STACK_VIEWPORT_HEIGHT");
    expect(overlay).toContain("marginTop: STACK_VIEWPORT_HEIGHT - props.maxHeight");
    expect(overlay).toContain("nestedScrollEnabled");
    expect(ownerTimelineViewport).toContain("scrollEnabled={!props.inlineQueueExpanded}");
    expect(ownerInlineQueueItem).toContain("style={styles.footerRow}");
  });

  it("offers a real retry for failed queued messages using the original command id", () => {
    expect(ownerInlineQueueItem).toContain('item.state === "failed" && onRetry !== undefined');
    expect(ownerInlineQueueItem).toContain('accessibilityLabel="Retry queued prompt"');
    expect(queueItem).toContain("onRetry(item.id)");
    expect(footer).toContain("onRetry: onRetryFailedMessage");
    expect(workspace).toMatch(/"companion\/queue\/retry",\s*\{\s*commandId,?\s*\}/u);
  });
});
