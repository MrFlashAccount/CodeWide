/** V1 QueueFeature owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import type { QueuedPrompt } from "../../data/thread-delivery-state";
import { colors, iconSize } from "../../theme";
import { AppSheet, AppSheetScrollView } from "../../ui/AppSheet";
import { InlineIcon } from "../../ui/InlineIcon";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./QueueFeature.styles";

export const QUEUE_DRAG_ROW_STEP = 76;

export function QueueDragHandle({
  disabled,
  onDrop,
}: {
  disabled: boolean;
  onDrop(offset: number): void;
}) {
  const translation = useSharedValue(0);
  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translation.get() }] }));
  const gesture = Gesture.Pan()
    .enabled(!disabled)
    .activateAfterLongPress(120)
    .onUpdate((event) => {
      translation.set(event.translationY);
    })
    .onEnd((event) => {
      const offset = Math.round(event.translationY / QUEUE_DRAG_ROW_STEP);
      translation.set(withTiming(0, { duration: 140 }));
      if (offset !== 0) runOnJS(onDrop)(offset);
    })
    .onFinalize(() => {
      translation.set(withTiming(0, { duration: 140 }));
    });
  return (
    <GestureDetector gesture={gesture}>
      <Reanimated.View
        accessibilityLabel="Drag queued prompt"
        style={[styles.queueDragHandle, dragStyle]}
      >
        <Ionicons
          name="reorder-three"
          size={iconSize.navigation}
          color={disabled ? colors.textDim : colors.textMuted}
        />
      </Reanimated.View>
    </GestureDetector>
  );
}

export function QueueManagerSheet({
  visible,
  onClose,
  embedded = false,
  items,
  activeTurnId,
  onEdit,
  onCancel,
  onMove,
  onSteer,
}: {
  visible: boolean;
  onClose(): void;
  embedded?: boolean;
  items: QueuedPrompt[];
  activeTurnId: string | null;
  onEdit?(item: QueuedPrompt): void;
  onCancel?(commandId: string): Promise<void>;
  onMove?(commandId: string, direction: -1 | 1): Promise<void>;
  onSteer?(commandId: string, expectedTurnId: string): Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Queue action failed");
    }
    setBusy(false);
  };
  const moveBy = async (item: QueuedPrompt, index: number, offset: number) => {
    if (onMove === undefined || item.state !== "queued") return;
    const target = Math.max(0, Math.min(items.length - 1, index + offset));
    const direction: -1 | 1 = target < index ? -1 : 1;
    for (let step = 0; step < Math.abs(target - index); step += 1) {
      await onMove(item.commandId, direction);
    }
  };
  const content = (
    <>
      {!embedded && (
        <View style={styles.menuTitleRow}>
          <Text style={styles.sheetTitle}>Queued prompts</Text>
          <View style={styles.flex} />
        </View>
      )}
      {items.length === 0 && (
        <Text style={styles.menuNotice}>Nothing is waiting for this thread.</Text>
      )}
      <AppSheetScrollView
        style={styles.menuScroll}
        contentContainerStyle={styles.menuScrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {items.map((item, index) => (
          <View key={item.commandId} style={styles.queueRow}>
            <View style={styles.queueCompactRow}>
              <QueueDragHandle
                disabled={busy || item.state !== "queued" || onMove === undefined}
                onDrop={(offset) => void run(() => moveBy(item, index, offset))}
              />
              <View style={styles.queueBody}>
                <Text numberOfLines={2} ellipsizeMode="tail" style={styles.queueText}>
                  {item.text || item.attachments.map(({ name }) => name).join(", ")}
                </Text>
                <View style={styles.queueMetaRow}>
                  <Text numberOfLines={1} style={styles.queueTime}>
                    {new Date(item.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · {item.state}
                  </Text>
                  {item.attachments.length > 0 && (
                    <Text numberOfLines={1} style={styles.queueTime}>
                      {" "}
                      · {item.attachments.length} attachment
                      {item.attachments.length === 1 ? "" : "s"}
                    </Text>
                  )}
                </View>
              </View>
              {activeTurnId !== null && (
                <Pressable
                  accessibilityLabel="Steer queued prompt"
                  disabled={busy || item.state !== "queued" || onSteer === undefined}
                  onPress={() =>
                    void run(() => onSteer?.(item.commandId, activeTurnId) ?? Promise.resolve())
                  }
                  style={styles.queueSteerButton}
                >
                  <InlineIcon name="navigate-outline" role="label" color={colors.onPrimary} />
                  <Text style={styles.queueSteerLabel}>Steer</Text>
                </Pressable>
              )}
              <Pressable
                accessibilityLabel="Edit queued prompt"
                disabled={busy || item.state !== "queued" || onEdit === undefined}
                onPress={() => onEdit?.(item)}
                style={styles.headerIcon}
              >
                <Ionicons name="create-outline" size={iconSize.action} color={colors.text} />
              </Pressable>
              <Pressable
                accessibilityLabel="Delete queued prompt"
                disabled={busy || item.state === "uncertain" || onCancel === undefined}
                onPress={() => void run(() => onCancel?.(item.commandId) ?? Promise.resolve())}
                style={styles.headerIcon}
              >
                <Ionicons name="trash-outline" size={iconSize.action} color={colors.red} />
              </Pressable>
            </View>
            {item.lastError !== null && <Text style={styles.errorText}>{item.lastError}</Text>}
          </View>
        ))}
      </AppSheetScrollView>
      {error !== null && <Text style={styles.errorText}>{error}</Text>}
    </>
  );
  return embedded ? (
    content
  ) : (
    <AppSheet
      isOpen={visible}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      contentProps={{
        dismissLabel: "Close queue",
        index: 0,
        snapPoints: ["55%", "90%"],
        enableDynamicSizing: false,
        enableOverDrag: false,
        contentContainerClassName: "h-full",
      }}
    >
      {content}
    </AppSheet>
  );
}

import type { InlineQueueOverlayItem } from "./inlineQueueContract";

export function projectInlineQueue(visibleQueuedPrompts: QueuedPrompt[]) {
  const inlineQueueOverlayItems: InlineQueueOverlayItem[] = visibleQueuedPrompts.map((entry) => ({
    id: entry.commandId,
    text: entry.text || entry.attachments.map(({ name }) => name).join(", ") || "Attachment",
    attachmentCount: entry.attachments.length,
    createdAt: entry.createdAt,
    state: entry.state,
    lastError: entry.lastError,
  }));
  return { inlineQueueOverlayItems };
}
