import { useThreadRowActions } from "./threadRowActions";
import { ThreadRowContent } from "./ThreadRowContent";
import type { ThreadRowProps } from "./threadRowContract";
import { ThreadRowWebMenu } from "./ThreadRowWebMenu";
import { useRef } from "react";
import { Platform } from "react-native";
import { Pressable as GesturePressable } from "react-native-gesture-handler";
import Swipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import { ActionMenu } from "../../ui/ActionMenu";
import { CommitOnChangeProbe } from "../../ui/CommitProbe";
import { ThreadRowCommitBoundary } from "../diagnostics/ThreadNavigationCommit";
import { copySessionId } from "../turnActions/turnActions";
import { styles } from "./ThreadRow.styles";
import { ThreadSwipeAction, ThreadSwipeActions } from "./ThreadSwipeActions";

export function ThreadRow(props: ThreadRowProps) {
  const { thread, server, selected, onPressIn, onPress, onTogglePin, onMarkRead } = props;
  const actions = useThreadRowActions(props);
  const {
    dialog,
    swipeableRef,
    setWebContextVisible,
    archiveAction,
    archiveLabel,
    swipeEnabled,
    menuActions,
    runThreadAction,
    closeSwipe,
  } = actions;

  const pressIntentCancelRef = useRef<(() => void) | null>(null);
  const pressIntentReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const row = (
    <ThreadRowCommitBoundary>
      <CommitOnChangeProbe scope={thread.id} revision={selected ? 1 : 0} onCommit={closeSwipe} />
      <GesturePressable
        {...(selected ? { testID: "selected-thread-row" } : {})}
        accessibilityRole="button"
        cancelable
        delayLongPress={350}
        onPressIn={() => {
          if (pressIntentReleaseTimerRef.current !== null)
            clearTimeout(pressIntentReleaseTimerRef.current);
          pressIntentReleaseTimerRef.current = null;
          pressIntentCancelRef.current?.();
          pressIntentCancelRef.current = onPressIn?.() ?? null;
        }}
        onPressOut={() => {
          const cancel = pressIntentCancelRef.current;
          if (cancel === null) return;
          // Gesture Handler dispatches onPressOut before onPress. Defer release
          // one task so a completed press can transfer the same intent instead
          // of evicting it in the gap between the two callbacks.
          pressIntentReleaseTimerRef.current = setTimeout(() => {
            pressIntentReleaseTimerRef.current = null;
            if (pressIntentCancelRef.current !== cancel) return;
            pressIntentCancelRef.current = null;
            cancel();
          }, 0);
        }}
        onPress={() => {
          if (pressIntentReleaseTimerRef.current !== null)
            clearTimeout(pressIntentReleaseTimerRef.current);
          pressIntentReleaseTimerRef.current = null;
          // The database keeps the transient lease until the mounted
          // conversation acquires its own lease in the retention effect.
          pressIntentCancelRef.current = null;
          swipeableRef.current?.close();
          onPress();
        }}
        {...(Platform.OS === "web"
          ? { onLongPress: () => setWebContextVisible(true), delayLongPress: 350 }
          : {})}
        style={({ pressed }) => [
          styles.threadRow,
          swipeEnabled && styles.threadRowSwipeChild,
          selected && styles.threadRowSelected,
          pressed && styles.pressed,
        ]}
      >
        <ThreadRowContent thread={thread} server={server} selected={selected} />
      </GesturePressable>
    </ThreadRowCommitBoundary>
  );
  const rowMenu =
    Platform.OS === "web" ? (
      row
    ) : (
      <ActionMenu
        accessibilityLabel="Thread actions"
        actions={menuActions}
        trigger="long-press"
        onSelect={(id) => {
          if (id === "copy-session-id")
            void copySessionId(thread.id).catch((cause) =>
              dialog.alert(
                "Copy failed",
                cause instanceof Error ? cause.message : "Could not copy session ID",
              ),
            );
          else if (id === "pin") runThreadAction(onTogglePin, thread.pinned ? "Unpin" : "Pin");
          else if (id === "read") runThreadAction(onMarkRead, "Mark as read");
          else if (id === "archive") runThreadAction(archiveAction, archiveLabel);
        }}
        style={styles.threadContextMenu}
      >
        {row}
      </ActionMenu>
    );
  return (
    <>
      {!swipeEnabled ? (
        rowMenu
      ) : (
        <Swipeable
          ref={swipeableRef}
          friction={1.8}
          leftThreshold={48}
          rightThreshold={48}
          dragOffsetFromLeftEdge={12}
          dragOffsetFromRightEdge={12}
          overshootLeft={false}
          overshootRight={false}
          containerStyle={styles.swipeContainer}
          childrenContainerStyle={styles.swipeChildren}
          renderRightActions={() => (
            <ThreadSwipeActions>
              <ThreadSwipeAction
                label={thread.pinned ? "Unpin" : "Pin"}
                icon="push-pin"
                tone="neutral"
                {...(onTogglePin === undefined
                  ? {}
                  : {
                      onPress: () =>
                        runThreadAction(onTogglePin, thread.pinned ? "Unpin" : "Pin", true),
                    })}
              />
              <ThreadSwipeAction
                label="Read"
                icon="checkmark-done-outline"
                tone="accent"
                {...(onMarkRead === undefined
                  ? {}
                  : { onPress: () => runThreadAction(onMarkRead, "Mark as read", true) })}
              />
              <ThreadSwipeAction
                label={archiveLabel}
                icon={thread.archived ? "archive" : "archive-outline"}
                tone={thread.archived ? "accent" : "danger"}
                {...(archiveAction === undefined
                  ? {}
                  : { onPress: () => runThreadAction(archiveAction, archiveLabel, true) })}
              />
            </ThreadSwipeActions>
          )}
        >
          {rowMenu}
        </Swipeable>
      )}
      <ThreadRowWebMenu props={props} actions={actions} />
    </>
  );
}
