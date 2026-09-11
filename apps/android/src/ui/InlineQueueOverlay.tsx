import * as Haptics from "expo-haptics";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { formatDeviceTime } from "../data/device-time";
import { useEvent } from "../react/useEvent";
import { colors, controlHitSlop, controlSize, radii, spacing, typeScale, typeWeight } from "../theme";
import { ActionMenu, type ActionMenuItem } from "./ActionMenu";
import { InlineIcon } from "./InlineIcon";
import { AppText as Text } from "./Typography";

export interface InlineQueueOverlayItem {
  readonly id: string;
  readonly text: string;
  readonly attachmentCount: number;
  readonly createdAt: number;
  readonly state: "queued" | "uncertain" | "failed";
  readonly lastError: string | null;
}

interface InlineQueueOverlayProps {
  readonly maxHeight: number;
  readonly expanded: boolean;
  readonly items: readonly InlineQueueOverlayItem[];
  readonly activeTurnId: string | null;
  onOpen(): void;
  onClose(): void;
  onEdit?(itemId: string): void;
  onCancel?(itemId: string): Promise<void>;
  onMove?(itemId: string, direction: -1 | 1): Promise<void>;
  onRetry?(itemId: string): Promise<void>;
  onSteer?(itemId: string, activeTurnId: string): Promise<void>;
  onRefresh?(): Promise<unknown>;
}

interface QueueLayout {
  readonly height: number;
  readonly item: InlineQueueOverlayItem;
  readonly targetOpacity: number;
  readonly targetScale: number;
  readonly targetY: number;
}

const STACK_VISIBLE_ITEMS = 2;
const STACK_HEIGHT = controlSize.regular;
const STACK_VIEWPORT_HEIGHT = controlSize.touch;
const STACK_OFFSET = spacing.xxs;
const CARD_GAP = spacing.optical;
const SWIPE_REVEAL = 72;
const ENTRY_OFFSET = 16;
const CARD_BORDER_WIDTH = 1;
const QUEUE_SPRING_GLIDE = { damping: 32, stiffness: 170, mass: 1 };
const QUEUE_SPRING_SNAPPY = { damping: 24, stiffness: 280, mass: 0.8 };
const SWIPE_EASING = Easing.bezier(0.22, 0.82, 0.18, 1);

function formatQueueTime(createdAtMilliseconds: number): string {
  return formatDeviceTime(createdAtMilliseconds / 1_000);
}

function playTargetHaptic(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

function playCommitHaptic(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
}

function resistedSwipe(distance: number): number {
  "worklet";
  if (distance <= SWIPE_REVEAL) return distance;
  return SWIPE_REVEAL + Math.sqrt(distance - SWIPE_REVEAL) * 7;
}

function calculateQueueLayouts(
  items: readonly InlineQueueOverlayItem[],
  measuredHeights: ReadonlyMap<string, number>,
  expanded: boolean,
): { readonly contentHeight: number; readonly layouts: readonly QueueLayout[] } {
  const layouts: QueueLayout[] = [];
  let expandedOffset = 0;
  for (const [index, item] of items.entries()) {
    const height = measuredHeights.get(item.id) ?? STACK_HEIGHT;
    layouts.push({
      height,
      item,
      targetOpacity: expanded || index < STACK_VISIBLE_ITEMS ? 1 : 0,
      targetScale: expanded ? 1 : Math.max(0.9, 1 - index * 0.05),
      targetY: expanded ? -expandedOffset : -Math.min(index, STACK_VISIBLE_ITEMS - 1) * STACK_OFFSET,
    });
    expandedOffset += height + CARD_GAP;
  }
  const contentHeight = expanded
    ? Math.max(STACK_VIEWPORT_HEIGHT, expandedOffset - (items.length > 0 ? CARD_GAP : 0))
    : STACK_VIEWPORT_HEIGHT;
  return { contentHeight, layouts };
}

interface AnimatedQueueBubbleProps {
  readonly children: ReactNode;
  readonly deleteEnabled: boolean;
  readonly expanded: boolean;
  readonly failed: boolean;
  readonly index: number;
  readonly itemCount: number;
  readonly measuredHeight: number;
  readonly raised: boolean;
  readonly reorderEnabled: boolean;
  readonly steerEnabled: boolean;
  readonly swipeDismissDistance: number;
  readonly targetOpacity: number;
  readonly targetScale: number;
  readonly targetY: number;
  onDelete(): Promise<boolean>;
  onMeasure(height: number): void;
  onReorder(offset: number): Promise<boolean>;
  onSteer(): Promise<boolean>;
}

function AnimatedQueueBubble({
  children,
  deleteEnabled,
  expanded,
  failed,
  index,
  itemCount,
  measuredHeight,
  raised,
  reorderEnabled,
  steerEnabled,
  swipeDismissDistance,
  targetOpacity,
  targetScale,
  targetY,
  onDelete,
  onMeasure,
  onReorder,
  onSteer,
}: AnimatedQueueBubbleProps): React.JSX.Element {
  const layoutY = useSharedValue(targetY + STACK_HEIGHT + ENTRY_OFFSET);
  const layoutScale = useSharedValue(0.94);
  const presence = useSharedValue(0);
  const animatedHeight = useSharedValue<number>(STACK_HEIGHT);
  const dismissOpacity = useSharedValue(1);
  const swipeX = useSharedValue(0);
  const swipeStartX = useSharedValue(0);
  const swipeDirection = useSharedValue<-1 | 0 | 1>(0);
  const swipeArmed = useSharedValue(false);
  const hapticPlayed = useSharedValue(false);
  const dragY = useSharedValue(0);
  const dragging = useSharedValue(false);
  const cardWidth = useSharedValue(0);
  const deleteItem = useEvent(async () => {
    const succeeded = await onDelete();
    if (!succeeded) {
      dismissOpacity.set(withTiming(1, { duration: 120 }));
      swipeX.set(withSpring(0, QUEUE_SPRING_SNAPPY));
    }
  });
  const steerItem = useEvent(async () => {
    const succeeded = await onSteer();
    if (!succeeded) {
      dismissOpacity.set(withTiming(1, { duration: 120 }));
      swipeX.set(withSpring(0, QUEUE_SPRING_SNAPPY));
    }
  });
  const reorderItem = useEvent((offset: number) => {
    if (offset !== 0) void onReorder(offset);
  });

  useEffect(() => {
    layoutY.set(withSpring(targetY, QUEUE_SPRING_GLIDE));
    layoutScale.set(withSpring(targetScale, QUEUE_SPRING_GLIDE));
    presence.set(withTiming(targetOpacity, { duration: 300 }));
    animatedHeight.set(withSpring(measuredHeight, QUEUE_SPRING_GLIDE));
  }, [animatedHeight, layoutScale, layoutY, measuredHeight, presence, targetOpacity, targetScale, targetY]);

  const cardStyle = useAnimatedStyle(() => ({
    height: animatedHeight.get(),
    opacity: presence.get() * dismissOpacity.get(),
    transform: [
      { translateY: layoutY.get() + dragY.get() },
      { scale: layoutScale.get() * (dragging.get() ? 1.025 : 1) },
    ],
    zIndex: dragging.get() ? itemCount + 10 : expanded ? 1 : itemCount - index,
  }));
  const swipeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: swipeX.get() }],
  }));
  const steerRevealStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, swipeX.get() / SWIPE_REVEAL)),
  }));
  const deleteRevealStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, -swipeX.get() / SWIPE_REVEAL)),
  }));

  const commitSwipe = (direction: -1 | 1): void => {
    "worklet";
    const distance = Math.max(swipeDismissDistance, cardWidth.get() + spacing.md);
    dismissOpacity.set(withDelay(170, withTiming(0, { duration: 100, easing: SWIPE_EASING })));
    swipeX.set(withTiming(direction * distance, { duration: 330, easing: SWIPE_EASING }, (finished) => {
      if (!finished) return;
      runOnJS(playCommitHaptic)();
      if (direction < 0) runOnJS(deleteItem)();
      else runOnJS(steerItem)();
    }));
  };

  const swipeGesture = Gesture.Pan()
    .withTestId("queued-prompt-swipe")
    .enabled(deleteEnabled || steerEnabled)
    .activeOffsetX([-8, 8])
    .failOffsetY([-16, 16])
    .maxPointers(1)
    .onBegin(() => {
      dismissOpacity.set(1);
      swipeStartX.set(swipeX.get());
      swipeDirection.set(swipeX.get() < 0 ? -1 : swipeX.get() > 0 ? 1 : 0);
      swipeArmed.set(false);
      hapticPlayed.set(false);
    })
    .onUpdate((event) => {
      const rawTranslation = swipeStartX.get() + event.translationX;
      if (rawTranslation <= -8 && deleteEnabled) swipeDirection.set(-1);
      else if (rawTranslation >= 8 && steerEnabled) swipeDirection.set(1);
      else if (Math.abs(rawTranslation) < 8) swipeDirection.set(0);
      const direction = swipeDirection.get();
      if (direction === 0 || Math.sign(rawTranslation) !== direction) {
        swipeX.set(0);
        return;
      }
      const distance = Math.abs(rawTranslation);
      swipeX.set(direction * resistedSwipe(distance));
      const commitDistance = Math.min(Math.max(cardWidth.get() * 0.5, SWIPE_REVEAL + 24), SWIPE_REVEAL + 48);
      const nextArmed = distance >= commitDistance;
      swipeArmed.set(nextArmed);
      if (nextArmed && !hapticPlayed.get()) {
        hapticPlayed.set(true);
        runOnJS(playTargetHaptic)();
      }
      if (!nextArmed) hapticPlayed.set(false);
    })
    .onEnd((event, success) => {
      const direction = swipeDirection.get();
      const rawTranslation = swipeStartX.get() + event.translationX;
      const velocityCommit = Math.abs(event.velocityX) >= 1_600 && Math.sign(event.velocityX) === direction;
      if (success && direction !== 0 && (swipeArmed.get() || velocityCommit)) {
        commitSwipe(direction);
        return;
      }
      if (success && direction !== 0 && Math.abs(rawTranslation) >= SWIPE_REVEAL / 2) {
        swipeX.set(withTiming(direction * SWIPE_REVEAL, { duration: 370, easing: SWIPE_EASING }));
        return;
      }
      swipeX.set(withSpring(0, QUEUE_SPRING_SNAPPY));
    })
    .onFinalize((_event, success) => {
      if (!success) swipeX.set(withSpring(0, QUEUE_SPRING_SNAPPY));
      swipeDirection.set(0);
      swipeStartX.set(swipeX.get());
      swipeArmed.set(false);
      hapticPlayed.set(false);
    });

  const reorderGesture = Gesture.Pan()
    .withTestId("queued-prompt-reorder")
    .enabled(expanded && reorderEnabled && itemCount > 1)
    .activateAfterLongPress(240)
    .failOffsetX([-16, 16])
    .maxPointers(1)
    .onStart(() => {
      dragging.set(true);
      runOnJS(playTargetHaptic)();
    })
    .onUpdate((event) => {
      dragY.set(event.translationY);
    })
    .onEnd((event, success) => {
      if (!success) return;
      const rowHeight = Math.max(STACK_HEIGHT, measuredHeight) + CARD_GAP;
      const requestedOffset = Math.round(-event.translationY / rowHeight);
      const offset = Math.max(-index, Math.min(itemCount - index - 1, requestedOffset));
      if (offset !== 0) runOnJS(reorderItem)(offset);
    })
    .onFinalize(() => {
      dragY.set(withSpring(0, QUEUE_SPRING_SNAPPY));
      dragging.set(false);
    });

  return (
    <Reanimated.View
      onLayout={(event) => {
        cardWidth.set(event.nativeEvent.layout.width);
      }}
      pointerEvents={expanded ? "box-none" : index === 0 ? "auto" : "none"}
      style={[styles.cardSlot, cardStyle, raised && styles.raisedCardSlot]}
    >
      <Reanimated.View pointerEvents="box-none" style={[styles.swipeAction, styles.steerSwipeAction, steerRevealStyle]}>
        <Pressable accessibilityLabel="Steer queued prompt" disabled={!steerEnabled} onPress={() => { void steerItem(); }} style={[styles.swipeActionContent, styles.steerSwipeActionContent]}>
          <InlineIcon name="navigate-outline" role="label" color={colors.onPrimary} />
          <Text style={[styles.swipeActionText, styles.steerSwipeActionText]}>Steer</Text>
        </Pressable>
      </Reanimated.View>
      <Reanimated.View pointerEvents="box-none" style={[styles.swipeAction, styles.deleteSwipeAction, deleteRevealStyle]}>
        <Pressable accessibilityLabel="Delete queued prompt" disabled={!deleteEnabled} onPress={() => { void deleteItem(); }} style={[styles.swipeActionContent, styles.deleteSwipeActionContent]}>
          <InlineIcon name="trash-outline" role="label" color={colors.text} />
          <Text style={styles.swipeActionText}>Delete</Text>
        </Pressable>
      </Reanimated.View>
      <GestureDetector gesture={Gesture.Race(reorderGesture, swipeGesture)}>
        <Reanimated.View style={[styles.bubble, failed && styles.failedBubble, swipeStyle]}>
          <View
            onLayout={(event) => {
              onMeasure(event.nativeEvent.layout.height + CARD_BORDER_WIDTH * 2);
            }}
            style={expanded ? styles.expandedBubbleContent : styles.collapsedBubbleContent}
          >
            {children}
          </View>
        </Reanimated.View>
      </GestureDetector>
    </Reanimated.View>
  );
}

/** One persistent set of measured cards that springs between a two-card stack and a list. */
export function InlineQueueOverlay({
  maxHeight,
  expanded,
  items,
  activeTurnId,
  onOpen,
  onClose,
  onEdit,
  onCancel,
  onMove,
  onRetry,
  onSteer,
  onRefresh,
}: InlineQueueOverlayProps): React.JSX.Element {
  const { width: viewportWidth } = useWindowDimensions();
  const listRef = useRef<ScrollView>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [measuredHeights, setMeasuredHeights] = useState<ReadonlyMap<string, number>>(new Map());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const refresh = (): Promise<unknown> => onRefresh === undefined ? Promise.resolve() : onRefresh();
  const run = async (itemId: string, action: () => Promise<void>, closeAfterSuccess: boolean): Promise<boolean> => {
    if (busyId !== null) return false;
    setBusyId(itemId);
    setActionError(null);
    try {
      await action();
      await refresh();
      setBusyId(null);
      if (closeAfterSuccess) onClose();
      return true;
    } catch (cause: unknown) {
      setBusyId(null);
      setActionError(cause instanceof Error ? cause.message : "Queue action failed");
      return false;
    }
  };
  const moveBy = (item: InlineQueueOverlayItem, index: number, offset: number): Promise<void> => {
    if (onMove === undefined || item.state !== "queued") return Promise.resolve();
    const target = Math.max(0, Math.min(items.length - 1, index + offset));
    const direction: -1 | 1 = target < index ? -1 : 1;
    let operation = Promise.resolve();
    for (let step = 0; step < Math.abs(target - index); step += 1) {
      operation = operation.then(() => onMove(item.id, direction));
    }
    return operation;
  };
  const measureItem = (itemId: string, height: number): void => {
    setMeasuredHeights((current) => {
      if (current.get(itemId) === height) return current;
      const next = new Map(current);
      next.set(itemId, height);
      return next;
    });
  };
  const busy = busyId !== null;
  const listMaxHeight = Math.max(controlSize.touch * 2, maxHeight);
  const { contentHeight, layouts } = calculateQueueLayouts(items, measuredHeights, expanded);

  useEffect(() => {
    if (expanded) listRef.current?.scrollToEnd({ animated: false });
  }, [contentHeight, expanded]);

  return (
    <View
      pointerEvents="box-none"
      testID="inline-queue-tail"
      style={[
        styles.tail,
        expanded && styles.expandedTail,
        expanded && { height: maxHeight, marginTop: STACK_VIEWPORT_HEIGHT - maxHeight },
      ]}
    >
      <Pressable accessible={expanded} accessibilityLabel="Close queue" pointerEvents={expanded ? "auto" : "none"} onPress={onClose} style={styles.backdrop} />
      <View pointerEvents="box-none" testID="inline-queue-overlay" style={styles.overlay}>
        <ScrollView
          ref={listRef}
          testID="inline-queue-list"
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          scrollEnabled={expanded && contentHeight > listMaxHeight}
          showsVerticalScrollIndicator={false}
          style={[styles.list, expanded ? { maxHeight: listMaxHeight } : styles.collapsedList]}
          contentContainerStyle={[styles.listContent, { height: contentHeight }]}
        >
          {layouts.map(({ height, item, targetOpacity, targetScale, targetY }, index) => {
            const itemBusy = busyId === item.id;
            const canMove = !busy && item.state === "queued" && onMove !== undefined;
            const deleteEnabled = !busy && item.state !== "uncertain" && onCancel !== undefined;
            const steerEnabled = !busy && activeTurnId !== null && item.state === "queued" && onSteer !== undefined;
            const overflowActions: ActionMenuItem[] = [
              {
                id: "edit",
                label: "Edit",
                icon: "create-outline",
                ...(item.state === "failed" ? { description: "Retry this prompt before editing" } : {}),
                disabled: busy || item.state !== "queued" || onEdit === undefined,
              },
              {
                id: "delete",
                label: "Delete",
                icon: "trash-outline",
                destructive: true,
                disabled: !deleteEnabled,
              },
            ];
            const selectOverflowAction = (actionId: string): void => {
              if (actionId === "edit" && onEdit !== undefined) {
                onEdit(item.id);
                return;
              }
              if (actionId === "delete" && onCancel !== undefined) {
                void run(item.id, () => onCancel(item.id), items.length === 1);
              }
            };
            const accessibilityActions = [
              ...(canMove && index > 0 ? [{ name: "moveEarlier", label: "Move earlier in queue" }] : []),
              ...(canMove && index < items.length - 1 ? [{ name: "moveLater", label: "Move later in queue" }] : []),
            ];
            return (
              <AnimatedQueueBubble
                key={item.id}
                deleteEnabled={deleteEnabled}
                expanded={expanded}
                failed={item.state === "failed"}
                index={index}
                itemCount={items.length}
                measuredHeight={height}
                raised={expanded && openMenuId === item.id}
                reorderEnabled={canMove}
                steerEnabled={steerEnabled}
                swipeDismissDistance={viewportWidth + spacing.md}
                targetOpacity={targetOpacity}
                targetScale={targetScale}
                targetY={targetY}
                onDelete={() => onCancel === undefined ? Promise.resolve(false) : run(item.id, () => onCancel(item.id), items.length === 1)}
                onMeasure={(measuredHeight) => measureItem(item.id, measuredHeight)}
                onReorder={(offset) => run(item.id, () => moveBy(item, index, offset), false)}
                onSteer={() => activeTurnId === null || onSteer === undefined
                  ? Promise.resolve(false)
                  : run(item.id, () => onSteer(item.id, activeTurnId), items.length === 1)}
              >
                <Pressable
                  accessible={expanded || index === 0}
                  accessibilityActions={accessibilityActions}
                  accessibilityHint={expanded ? "Long press and drag to reorder. Swipe left to delete or right to steer." : undefined}
                  accessibilityLabel={index === 0
                    ? (expanded ? "Queued prompt" : "Open queue, " + String(items.length) + " messages")
                    : "Queued prompt"}
                  accessibilityRole={index === 0 && !expanded ? "button" : undefined}
                  onAccessibilityAction={(event) => {
                    if (event.nativeEvent.actionName === "moveEarlier") void run(item.id, () => moveBy(item, index, -1), false);
                    if (event.nativeEvent.actionName === "moveLater") void run(item.id, () => moveBy(item, index, 1), false);
                  }}
                  onPress={index === 0 && !expanded ? onOpen : undefined}
                  pointerEvents={expanded || index === 0 ? "auto" : "none"}
                  style={styles.contentRow}
                >
                  {!expanded && index === 0 ? (
                    <>
                      <InlineIcon name="reorder-three-outline" role="label" color={colors.accent} />
                      <Text numberOfLines={1} ellipsizeMode="tail" style={styles.stackLine}>
                        <Text style={styles.stackTitle}>Queue · {items.length}</Text>
                        <Text style={styles.stackPreview}> {item.text}</Text>
                      </Text>
                      <InlineIcon name="chevron-up" role="label" color={colors.textMuted} />
                    </>
                  ) : (
                    <View style={styles.body}>
                      <Text numberOfLines={expanded ? 2 : 1} ellipsizeMode="tail" style={expanded ? styles.message : styles.stackPreview}>
                        {item.text}
                      </Text>
                    </View>
                  )}
                </Pressable>
                {expanded && item.lastError !== null && <Text style={styles.errorText}>{item.lastError}</Text>}
                {expanded && (
                  <View style={styles.footerRow}>
                    <View style={styles.metaRow}>
                      <Text numberOfLines={1} style={styles.meta}>
                        {formatQueueTime(item.createdAt)} · {item.state}
                        {item.attachmentCount > 0
                          ? ` · ${item.attachmentCount} attachment${item.attachmentCount === 1 ? "" : "s"}`
                          : ""}
                      </Text>
                    </View>
                    <View style={styles.actions}>
                      {item.state === "failed" && onRetry !== undefined && (
                        <Pressable
                          accessibilityLabel="Retry queued prompt"
                          disabled={busy}
                          hitSlop={controlHitSlop.regular}
                          onPress={() => { void run(item.id, () => onRetry(item.id), false); }}
                          style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
                        >
                          {itemBusy
                            ? <ActivityIndicator size="small" color={colors.textMuted} />
                            : <InlineIcon name="refresh" role="label" color={colors.textMuted} />}
                          <Text style={styles.retryText}>Retry</Text>
                        </Pressable>
                      )}
                      {steerEnabled && activeTurnId !== null && onSteer !== undefined && (
                        <Pressable
                          accessibilityLabel="Steer queued prompt"
                          disabled={busy}
                          onPress={() => { void run(item.id, () => onSteer(item.id, activeTurnId), items.length === 1); }}
                          style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
                        >
                          <InlineIcon name="navigate-outline" role="label" color={colors.textMuted} />
                          <Text style={styles.actionText}>Steer</Text>
                        </Pressable>
                      )}
                      <ActionMenu
                        accessibilityLabel="Queued prompt actions"
                        actions={overflowActions}
                        menuWidth={224}
                        onOpenChange={(open) => setOpenMenuId((current) =>
                          open ? item.id : current === item.id ? null : current)}
                        onSelect={selectOverflowAction}
                      >
                        <Pressable
                          accessibilityLabel="Queued prompt actions"
                          disabled={busy}
                          hitSlop={controlHitSlop.regular}
                          style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
                        >
                          <InlineIcon name="ellipsis-vertical" role="label" color={colors.textMuted} />
                        </Pressable>
                      </ActionMenu>
                    </View>
                  </View>
                )}
              </AnimatedQueueBubble>
            );
          })}
        </ScrollView>
        {expanded && actionError !== null && <Text accessibilityLiveRegion="polite" style={styles.actionError}>{actionError}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: "center",
    borderRadius: radii.medium,
    flexDirection: "row",
    gap: spacing.optical,
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.xs,
  },
  actionError: {
    alignSelf: "stretch",
    backgroundColor: colors.errorContainer,
    borderRadius: radii.medium,
    color: colors.error,
    marginTop: spacing.optical,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
    ...typeScale.caption,
  },
  actionText: { color: colors.textMuted, ...typeScale.caption, fontWeight: typeWeight.semibold },
  actions: { alignItems: "center", flexDirection: "row", flexShrink: 0, justifyContent: "flex-end" },
  backdrop: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0, zIndex: 1 },
  body: { flex: 1, gap: spacing.optical, minWidth: 0 },
  bubble: {
    backgroundColor: colors.surfaceContainerHigh,
    borderColor: colors.border,
    borderRadius: radii.selected,
    borderWidth: CARD_BORDER_WIDTH,
    height: "100%",
    overflow: "hidden",
  },
  cardSlot: { bottom: 0, left: 0, position: "absolute", right: 0 },
  collapsedBubbleContent: {
    height: STACK_HEIGHT - CARD_BORDER_WIDTH * 2,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  collapsedList: { height: STACK_VIEWPORT_HEIGHT, marginTop: 0, overflow: "visible" },
  contentRow: { alignItems: "center", flexDirection: "row", gap: spacing.xxs, minHeight: 0 },
  deleteSwipeAction: { backgroundColor: colors.red },
  deleteSwipeActionContent: { alignSelf: "flex-end" },
  errorText: { color: colors.error, ...typeScale.caption },
  expandedBubbleContent: {
    gap: spacing.xxs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  expandedTail: { zIndex: 60 },
  failedBubble: { backgroundColor: colors.errorContainer, borderColor: colors.error },
  list: { flexGrow: 0, flexShrink: 1, minHeight: 0, overflow: "visible" },
  listContent: { position: "relative" },
  message: { color: colors.text, ...typeScale.body },
  meta: { color: colors.textMuted, ...typeScale.caption, fontVariant: ["tabular-nums"] },
  footerRow: { alignItems: "center", flexDirection: "row", gap: spacing.xs, minWidth: 0 },
  metaRow: { flex: 1, minWidth: 0 },
  moreButton: {
    alignItems: "center",
    height: controlSize.compact,
    justifyContent: "center",
    marginRight: -spacing.xxs,
    width: controlSize.compact,
  },
  overlay: { bottom: 0, position: "absolute", right: 0, width: "82%", zIndex: 2 },
  pressed: { opacity: 0.72 },
  raisedCardSlot: { zIndex: 100 },
  retryButton: {
    alignItems: "center",
    borderRadius: radii.medium,
    flexDirection: "row",
    gap: spacing.optical,
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.xxs,
  },
  retryText: { color: colors.textMuted, ...typeScale.caption, fontWeight: typeWeight.semibold },
  stackPreview: { color: colors.textMuted, ...typeScale.caption },
  stackLine: { flex: 1, minWidth: 0 },
  stackTitle: { color: colors.text, flexShrink: 0, ...typeScale.label, fontWeight: typeWeight.semibold },
  steerSwipeAction: { backgroundColor: colors.primary },
  steerSwipeActionContent: { alignSelf: "flex-start" },
  steerSwipeActionText: { color: colors.onPrimary },
  swipeAction: {
    borderRadius: radii.selected,
    bottom: 0,
    left: 0,
    overflow: "hidden",
    position: "absolute",
    right: 0,
    top: 0,
  },
  swipeActionContent: { alignItems: "center", flex: 1, gap: spacing.optical, justifyContent: "center", width: SWIPE_REVEAL },
  swipeActionText: { color: colors.text, ...typeScale.caption, fontWeight: typeWeight.semibold },
  tail: { minHeight: STACK_VIEWPORT_HEIGHT, overflow: "visible", position: "relative", width: "100%" },
});
