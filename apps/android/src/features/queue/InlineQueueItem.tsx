import { ActivityIndicator, Pressable, View } from "react-native";
import { colors, controlHitSlop, spacing } from "../../theme";
import { ActionMenu, type ActionMenuItem } from "../../ui/ActionMenu";
import { InlineIcon } from "../../ui/InlineIcon";
import { AppText as Text } from "../../ui/Typography";
import { AnimatedQueueBubble } from "./AnimatedQueueBubble";
import type { InlineQueueOverlayProps } from "./inlineQueueContract";
import { formatQueueTime } from "./inlineQueueLayout";
import { styles } from "./InlineQueueOverlay.styles";
import type { useInlineQueueOverlay } from "./inlineQueueState";

/** One measured queue card; the overlay owns ordering, pending and animated layout state. */
export function renderInlineQueueItem(
  layout: ReturnType<typeof useInlineQueueOverlay>["layouts"][number],
  index: number,
  props: InlineQueueOverlayProps,
  overlay: ReturnType<typeof useInlineQueueOverlay>,
) {
  const { activeTurnId, onCancel, onRetry, onSteer } = props;
  const { height, item, targetOpacity, targetScale, targetY } = layout;

  const itemBusy = overlay.busyId === item.id;
  const canMove = !overlay.busy && item.state === "queued" && props.onMove !== undefined;
  const deleteEnabled = !overlay.busy && item.state !== "uncertain" && onCancel !== undefined;
  const steerEnabled =
    !overlay.busy && activeTurnId !== null && item.state === "queued" && onSteer !== undefined;
  const overflowActions: ActionMenuItem[] = [
    {
      icon: "create-outline",
      id: "edit",
      label: "Edit",
      ...(item.state === "failed" ? { description: "Retry this prompt before editing" } : {}),
      disabled: overlay.busy || item.state !== "queued" || props.onEdit === undefined,
    },
    {
      destructive: true,
      disabled: !deleteEnabled,
      icon: "trash-outline",
      id: "delete",
      label: "Delete",
    },
  ];
  const selectOverflowAction = (actionId: string): void => {
    if (actionId === "edit" && props.onEdit !== undefined) {
      props.onEdit(item.id);
      return;
    }
    if (actionId === "delete" && onCancel !== undefined) {
      overlay.activate(item.id, async () => onCancel(item.id), props.items.length === 1);
    }
  };
  const accessibilityActions = [
    ...(canMove && index > 0 ? [{ label: "Move earlier in queue", name: "moveEarlier" }] : []),
    ...(canMove && index < props.items.length - 1
      ? [{ label: "Move later in queue", name: "moveLater" }]
      : []),
  ];
  return (
    <AnimatedQueueBubble
      deleteEnabled={deleteEnabled}
      expanded={props.expanded}
      failed={item.state === "failed"}
      index={index}
      itemCount={props.items.length}
      key={item.id}
      measuredHeight={height}
      onDelete={async () =>
        onCancel === undefined
          ? Promise.resolve(false)
          : overlay.run(item.id, async () => onCancel(item.id), props.items.length === 1)
      }
      onMeasure={(measuredHeight) => {
        overlay.measureItem(item.id, measuredHeight);
      }}
      onReorder={async (offset) =>
        overlay.run(item.id, async () => overlay.moveBy(item, index, offset), false)
      }
      onSteer={async () =>
        activeTurnId === null || onSteer === undefined
          ? Promise.resolve(false)
          : overlay.run(
              item.id,
              async () => onSteer(item.id, activeTurnId),
              props.items.length === 1,
            )
      }
      raised={props.expanded && overlay.openMenuId === item.id}
      reorderEnabled={canMove}
      steerEnabled={steerEnabled}
      swipeDismissDistance={overlay.viewportWidth + spacing.md}
      targetOpacity={targetOpacity}
      targetScale={targetScale}
      targetY={targetY}
    >
      <Pressable
        accessibilityActions={accessibilityActions}
        accessibilityHint={
          props.expanded
            ? "Long press and drag to reorder. Swipe left to delete or right to steer."
            : undefined
        }
        accessibilityLabel={
          index === 0
            ? props.expanded
              ? "Queued prompt"
              : "Open queue, " + String(props.items.length) + " messages"
            : "Queued prompt"
        }
        accessibilityRole={index === 0 && !props.expanded ? "button" : undefined}
        accessible={props.expanded || index === 0}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "moveEarlier") {
            overlay.activate(item.id, async () => overlay.moveBy(item, index, -1), false);
          }
          if (event.nativeEvent.actionName === "moveLater") {
            overlay.activate(item.id, async () => overlay.moveBy(item, index, 1), false);
          }
        }}
        onPress={index === 0 && !props.expanded ? props.onOpen : undefined}
        pointerEvents={props.expanded || index === 0 ? "auto" : "none"}
        style={styles.contentRow}
      >
        {!props.expanded && index === 0 ? (
          <>
            <InlineIcon color={colors.accent} name="reorder-three-outline" role="label" />
            <Text ellipsizeMode="tail" numberOfLines={1} style={styles.stackLine}>
              <Text style={styles.stackTitle}>Queue · {props.items.length}</Text>
              <Text style={styles.stackPreview}> {item.text}</Text>
            </Text>
            <InlineIcon color={colors.textMuted} name="chevron-up" role="label" />
          </>
        ) : (
          <View style={styles.body}>
            <Text
              ellipsizeMode="tail"
              numberOfLines={props.expanded ? 2 : 1}
              style={props.expanded ? styles.message : styles.stackPreview}
            >
              {item.text}
            </Text>
          </View>
        )}
      </Pressable>
      {props.expanded && item.lastError !== null && (
        <Text style={styles.errorText}>{item.lastError}</Text>
      )}
      {props.expanded && (
        <View style={styles.footerRow}>
          <View style={styles.metaRow}>
            <Text numberOfLines={1} style={styles.meta}>
              {formatQueueTime(item.createdAt)} · {item.state}
              {item.attachmentCount > 0
                ? ` · ${String(item.attachmentCount)} attachment${item.attachmentCount === 1 ? "" : "s"}`
                : ""}
            </Text>
          </View>
          <View style={styles.actions}>
            {item.state === "failed" && onRetry !== undefined && (
              <Pressable
                accessibilityLabel="Retry queued prompt"
                disabled={overlay.busy}
                hitSlop={controlHitSlop.regular}
                onPress={() => {
                  overlay.activate(item.id, async () => onRetry(item.id), false);
                }}
                style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
              >
                {itemBusy ? (
                  <ActivityIndicator color={colors.textMuted} size="small" />
                ) : (
                  <InlineIcon color={colors.textMuted} name="refresh" role="label" />
                )}
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            )}
            {steerEnabled && (
              <Pressable
                accessibilityLabel="Steer queued prompt"
                disabled={overlay.busy}
                onPress={() => {
                  overlay.activate(
                    item.id,
                    async () => onSteer(item.id, activeTurnId),
                    props.items.length === 1,
                  );
                }}
                style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
              >
                <InlineIcon color={colors.textMuted} name="navigate-outline" role="label" />
                <Text style={styles.actionText}>Steer</Text>
              </Pressable>
            )}
            <ActionMenu
              accessibilityLabel="Queued prompt actions"
              actions={overflowActions}
              menuWidth={224}
              onOpenChange={(open) => {
                overlay.setOpenMenuId((current) =>
                  open ? item.id : current === item.id ? null : current,
                );
              }}
              onSelect={selectOverflowAction}
            >
              <Pressable
                accessibilityLabel="Queued prompt actions"
                disabled={overlay.busy}
                hitSlop={controlHitSlop.regular}
                style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
              >
                <InlineIcon color={colors.textMuted} name="ellipsis-vertical" role="label" />
              </Pressable>
            </ActionMenu>
          </View>
        </View>
      )}
    </AnimatedQueueBubble>
  );
}
