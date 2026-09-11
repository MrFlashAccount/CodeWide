import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { compactSource } from "./source-contract";

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const screen = compactSource(readSource("../src/CodeWideScreen.tsx"));
const overlay = readSource("../src/ui/InlineQueueOverlay.tsx");
const workspace = readSource("../src/data/use-remote-workspace.ts");

describe("inline queue overlay", () => {
  it("springs one measured set of cards from a two-layer stack into the floating list", () => {
    expect(screen).toContain("<InlineQueueOverlay");
    expect(screen).toContain("onOpen={toggleInlineQueueOverlay}");
    expect(screen).toContain("expanded={inlineQueueExpanded}");
    expect(screen).not.toContain("InlineQueueStack");
    expect(overlay).toContain('testID="inline-queue-tail"');
    expect(overlay).toContain('testID="inline-queue-list"');
    expect(overlay).toContain("<ScrollView");
    expect(overlay).toContain("const STACK_VISIBLE_ITEMS = 2");
    expect(overlay).toContain("expanded ? styles.expandedBubbleContent : styles.collapsedBubbleContent");
    expect(overlay).toContain("calculateQueueLayouts(items, measuredHeights, expanded)");
    expect(overlay).toContain("layoutY.set(withSpring(targetY, QUEUE_SPRING_GLIDE))");
    expect(overlay).not.toContain("withDelay(delay");
    expect(overlay).toContain("targetScale: expanded ? 1 : Math.max(0.9, 1 - index * 0.05)");
    expect(overlay).toContain("targetOpacity: expanded || index < STACK_VISIBLE_ITEMS ? 1 : 0");
    expect(overlay).toContain("onMeasure(event.nativeEvent.layout.height + CARD_BORDER_WIDTH * 2)");
    expect(overlay).toContain("animatedHeight.set(withSpring(measuredHeight, QUEUE_SPRING_GLIDE))");
    expect(overlay).toContain("height: animatedHeight.get()");
    expect(overlay).toContain("const SWIPE_EASING = Easing.bezier(0.22, 0.82, 0.18, 1)");
    expect(overlay).not.toContain("LinearTransition");
    expect(overlay).not.toContain("rotateX");
    expect(overlay).not.toContain("perspective");
    expect(overlay).toContain("!expanded && index === 0");
    expect(overlay).toMatch(
      /<Text numberOfLines=\{1\} ellipsizeMode="tail" style=\{styles\.stackLine\}>[\s\S]*styles\.stackTitle[\s\S]*styles\.stackPreview[\s\S]*<\/Text>/u,
    );
    expect(overlay).toContain('contentRow: { alignItems: "center"');
    expect(overlay).not.toContain("styles.headerBubble");
    expect(overlay).not.toContain('name="close"');
    expect(overlay).not.toContain("AppSheet");
    expect(overlay).not.toMatch(/elevation|shadow/u);
  });

  it("supports swipe actions and drag reorder without reorder menu buttons", () => {
    expect(overlay).toContain('<Text style={styles.retryText}>Retry</Text>');
    expect(overlay).toContain('<Text style={styles.actionText}>Steer</Text>');
    expect(overlay).toContain('withTestId("queued-prompt-swipe")');
    expect(overlay).toContain('withTestId("queued-prompt-reorder")');
    expect(overlay).toContain("activateAfterLongPress(240)");
    expect(overlay).toContain("Gesture.Race(reorderGesture, swipeGesture)");
    expect(overlay).toContain('pointerEvents={expanded ? "box-none" : index === 0 ? "auto" : "none"}');
    expect(overlay).toContain("expanded ? 1 : itemCount - index");
    expect(overlay).toContain("raised={expanded && openMenuId === item.id}");
    expect(overlay).toContain("onOpenChange={(open) => setOpenMenuId");
    expect(overlay).toContain('<Text style={styles.swipeActionText}>Delete</Text>');
    expect(overlay).toContain('<Text style={[styles.swipeActionText, styles.steerSwipeActionText]}>Steer</Text>');
    expect(overlay).toContain('name="ellipsis-vertical"');
    expect(overlay).not.toContain('name="ellipsis-horizontal"');
    expect(overlay).toContain('name="navigate-outline" role="label" color={colors.onPrimary}');
    expect(overlay).toContain("rawTranslation >= 8 && steerEnabled");
    expect(overlay).toContain("swipeDismissDistance={viewportWidth + spacing.md}");
    expect(overlay).toContain("dismissOpacity.set(withDelay(170, withTiming(0");
    expect(overlay).toContain("<ActionMenu");
    expect(overlay).toContain('accessibilityLabel="Queued prompt actions"');
    expect(overlay).toContain('label: "Edit"');
    expect(overlay).toContain('label: "Delete"');
    expect(overlay).not.toContain('label: "Up in queue"');
    expect(overlay).not.toContain('label: "Down in queue"');
    expect(overlay).not.toContain('<Text style={styles.actionText}>Edit</Text>');
    expect(overlay).not.toContain('accessibilityLabel="Move queued prompt earlier"');
    expect(overlay).toContain('numberOfLines={expanded ? 2 : 1}');
    expect(overlay).toContain("left: 0");
    expect(overlay).toContain("right: 0");
    expect(overlay).toContain("width: SWIPE_REVEAL");
  });

  it("matches message-bubble geometry and formats time from device preferences", () => {
    expect(overlay).toContain('import { formatDeviceTime } from "../data/device-time"');
    expect(overlay).toContain("formatDeviceTime(createdAtMilliseconds / 1_000)");
    expect(overlay).not.toContain("toLocaleTimeString");
    expect(overlay).toContain("borderRadius: radii.selected");
    expect(overlay).toContain("paddingHorizontal: spacing.sm");
    expect(overlay).toContain("paddingVertical: spacing.xs");
  });

  it("renders at the timeline tail without adding queue height to the composer", () => {
    expect(screen).toContain("queuedComposerEdit === null && !threadSearchActive && inlineQueueOverlayItems.length > 0");
    expect(screen).toContain("maxHeight={inlineQueueMaxHeight}");
    expect(screen).not.toContain("inlineQueueAnchor");
    expect(screen).not.toContain("measureInlineQueueOverlayAnchor");
    expect(overlay).toContain('width: "82%"');
    expect(overlay).toContain('position: "absolute"');
    expect(overlay).toContain("minHeight: STACK_VIEWPORT_HEIGHT");
    expect(overlay).toContain("marginTop: STACK_VIEWPORT_HEIGHT - maxHeight");
    expect(overlay).toContain("nestedScrollEnabled");
    expect(screen).toContain("scrollEnabled={!inlineQueueExpanded}");
    expect(overlay).toContain("style={styles.footerRow}");
  });

  it("offers a real retry for failed queued messages using the original command id", () => {
    expect(overlay).toContain('item.state === "failed" && onRetry !== undefined');
    expect(overlay).toContain('accessibilityLabel="Retry queued prompt"');
    expect(overlay).toContain("onRetry(item.id)");
    expect(screen).toContain("onRetry: onRetryFailedMessage");
    expect(workspace).toContain('"companion/queue/retry", { commandId }');
  });
});
