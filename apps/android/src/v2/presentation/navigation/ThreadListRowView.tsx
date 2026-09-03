import Swipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { useCallback, useRef, useState, useTransition } from "react";
import { Pressable, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors } from "../../theme";
import { ActionMenu } from "../../ui/ActionMenu";
import { PresentationIcon } from "../icons/PresentationIcon";
import { PresentationText as Text, ProductText } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";
import { ThreadSwipeActions } from "./ThreadSwipeActions";
import type { ThreadListRow, ThreadListRowActions } from "./threadListTypes";
import {
  isThreadListRowAction,
  resolveThreadListRowAction,
  threadListActionPendingLabel,
  threadListRowAccessibilityStatus,
  threadListRowPreview,
  threadListRowActionMenu,
  type ThreadListRowAction,
} from "./threadListRowModel";
import {
  selectedThreadStyle,
  threadListRowStyles as styles,
  unselectedThreadStyle,
} from "./threadListRowStyles";

interface ThreadListRowViewProps {
  actions?: ThreadListRowActions;
  onActionError?(message: string): void;
  onOpen(id: string): void;
  onPrewarm?(id: string): void;
  row: ThreadListRow;
  selected: boolean;
}

export function ThreadListRowView(props: ThreadListRowViewProps): React.JSX.Element {
  const { actions, onActionError, onOpen, onPrewarm, row, selected } = props;
  const swipeable = useRef<SwipeableMethods | null>(null);
  const [pendingAction, setPendingAction] = useState<ThreadListRowAction | null>(null);
  const [pending, startAction] = useTransition();
  const active = row.state === "running" && !row.retained;
  const attention = row.state === "waitingForApproval" || row.state === "waitingForInput";
  const accessibilityStatus = threadListRowAccessibilityStatus(row);
  const open = useEvent(() => {
    swipeable.current?.close();
    onOpen(row.id);
  });
  const prewarm = useEvent(() => onPrewarm?.(row.id));
  const run = useEvent((kind: ThreadListRowAction) => {
    if (actions === undefined || pending) return;
    const operation = resolveThreadListRowAction(actions, row, kind);
    if (operation === null) return;
    swipeable.current?.close();
    setPendingAction(kind);
    startAction(() =>
      settleThreadAction(operation).then((result) => {
        if (!result.ok) {
          onActionError?.(
            result.cause instanceof Error ? result.cause.message : "Thread action failed",
          );
        }
        setPendingAction(null);
      }),
    );
  });
  const selectMenuAction = useEvent((id: string) => {
    if (isThreadListRowAction(id)) run(id);
  });
  const togglePin = useEvent((): void => {
    run("togglePin");
  });
  const markRead = useEvent((): void => {
    run("markRead");
  });
  const archive = useEvent((): void => {
    run("archive");
  });
  // Swipeable invokes this callback during render, so useEvent's render-call guard is intentional.
  // oxlint-disable-next-line react-doctor/react-compiler-no-manual-memoization
  const renderRightActions = useCallback((): React.JSX.Element => {
    return (
      <ThreadSwipeActions
        archived={row.archived === true}
        onArchive={archive}
        onMarkRead={markRead}
        onTogglePin={togglePin}
        pending={pending}
        pinned={row.pinned === true}
        remoteDisabled={row.retained}
        unread={row.unread > 0 && row.latestActivityMarker !== null}
      />
    );
  }, [
    archive,
    markRead,
    pending,
    row.archived,
    row.latestActivityMarker,
    row.pinned,
    row.retained,
    row.unread,
    togglePin,
  ]);
  const content = (
    <Pressable
      accessibilityLabel={`Open thread ${row.title} ${row.id}`}
      accessibilityRole="button"
      accessibilityState={{ busy: pending, selected }}
      {...(accessibilityStatus === undefined
        ? {}
        : { accessibilityValue: { text: accessibilityStatus } })}
      onPress={open}
      onPressIn={prewarm}
      style={selected ? selectedThreadStyle : unselectedThreadStyle}
    >
      <View style={styles.threadCopy}>
        <View style={styles.titleRow}>
          {attention ? <PresentationIcon color={colors.red} name="alert" size={14} /> : null}
          <View style={styles.titleSlot}>
            {active ? (
              <ShimmerText
                containerStyle={styles.titleShimmer}
                style={styles.title}
                text={row.title}
              />
            ) : (
              <ProductText numberOfLines={1} style={styles.title} weight="semibold">
                {row.title}
              </ProductText>
            )}
          </View>
          <View style={styles.threadMeta}>
            <View style={styles.unreadSlot}>
              {row.unread > 0 ? (
                <View
                  accessibilityLabel={`${row.unread} unread ${row.unread === 1 ? "message" : "messages"}`}
                  accessible
                  style={styles.unreadDot}
                />
              ) : null}
            </View>
            <Text numberOfLines={1} style={styles.time} testID="thread-time">
              {row.updatedAt}
            </Text>
          </View>
        </View>
        <View style={styles.previewRow}>
          <ProductText numberOfLines={1} style={styles.preview} tone="muted">
            {pendingAction === null
              ? threadListRowPreview(row)
              : threadListActionPendingLabel(pendingAction)}
          </ProductText>
        </View>
      </View>
    </Pressable>
  );
  if (actions === undefined) return content;
  const menu = (
    <ActionMenu
      accessibilityLabel="Thread actions"
      actions={threadListRowActionMenu(row, pending)}
      onSelect={selectMenuAction}
      style={styles.contextMenu}
      trigger="long-press"
    >
      {content}
    </ActionMenu>
  );
  return (
    <Swipeable
      childrenContainerStyle={styles.swipeChildren}
      containerStyle={styles.swipeContainer}
      dragOffsetFromLeftEdge={12}
      dragOffsetFromRightEdge={12}
      friction={1.8}
      leftThreshold={48}
      overshootLeft={false}
      overshootRight={false}
      ref={swipeable}
      renderRightActions={renderRightActions}
      rightThreshold={48}
    >
      {menu}
    </Swipeable>
  );
}

type SettledThreadAction = { ok: true } | { cause: unknown; ok: false };

function settleThreadAction(operation: () => Promise<void>): Promise<SettledThreadAction> {
  const action = new Promise<void>((resolve) => {
    resolve(operation());
  });
  return action.then(
    (): SettledThreadAction => ({ ok: true }),
    (cause: unknown): SettledThreadAction => ({ cause, ok: false }),
  );
}
