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
  const { onMarkRead, onPress, onPressIn, onTogglePin, selected, server, thread } = props;
  const actions = useThreadRowActions(props);
  const {
    archiveAction,
    archiveLabel,
    closeSwipe,
    dialog,
    menuActions,
    runThreadAction,
    setWebContextVisible,
    swipeableRef,
    swipeEnabled,
  } = actions;

  const pressIntentCancelRef = useRef<(() => void) | null>(null);
  const pressIntentReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const row = (
    <ThreadRowCommitBoundary>
      <CommitOnChangeProbe onCommit={closeSwipe} revision={selected ? 1 : 0} scope={thread.id} />
      <GesturePressable
        {...(selected ? { testID: "selected-thread-row" } : {})}
        accessibilityRole="button"
        cancelable
        delayLongPress={350}
        onPress={() => {
          if (pressIntentReleaseTimerRef.current !== null) {
            clearTimeout(pressIntentReleaseTimerRef.current);
          }
          pressIntentReleaseTimerRef.current = null;
          // The database keeps the transient lease until the mounted
          // conversation acquires its own lease in the retention effect.
          pressIntentCancelRef.current = null;
          swipeableRef.current?.close();
          onPress();
        }}
        onPressIn={() => {
          if (pressIntentReleaseTimerRef.current !== null) {
            clearTimeout(pressIntentReleaseTimerRef.current);
          }
          pressIntentReleaseTimerRef.current = null;
          pressIntentCancelRef.current?.();
          pressIntentCancelRef.current = onPressIn?.() ?? null;
        }}
        onPressOut={() => {
          const cancel = pressIntentCancelRef.current;
          if (cancel === null) {
            return;
          }
          // Gesture Handler dispatches onPressOut before onPress. Defer release
          // one task so a completed press can transfer the same intent instead
          // of evicting it in the gap between the two callbacks.
          pressIntentReleaseTimerRef.current = setTimeout(() => {
            pressIntentReleaseTimerRef.current = null;
            if (pressIntentCancelRef.current !== cancel) {
              return;
            }
            pressIntentCancelRef.current = null;
            cancel();
          }, 0);
        }}
        {...(Platform.OS === "web"
          ? {
              delayLongPress: 350,
              onLongPress: () => {
                setWebContextVisible(true);
              },
            }
          : {})}
        style={({ pressed }) => [
          styles.threadRow,
          swipeEnabled && styles.threadRowSwipeChild,
          selected && styles.threadRowSelected,
          pressed && styles.pressed,
        ]}
      >
        <ThreadRowContent selected={selected} server={server} thread={thread} />
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
        onSelect={(id) => {
          if (id === "copy-session-id") {
            void copySessionId(thread.id).catch((error: unknown) => {
              dialog.alert(
                "Copy failed",
                error instanceof Error ? error.message : "Could not copy session ID",
              );
            });
          } else if (id === "pin") {
            runThreadAction(onTogglePin, thread.pinned ? "Unpin" : "Pin");
          } else if (id === "read") {
            runThreadAction(onMarkRead, "Mark as read");
          } else if (id === "archive") {
            runThreadAction(archiveAction, archiveLabel);
          }
        }}
        style={styles.threadContextMenu}
        trigger="long-press"
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
          childrenContainerStyle={styles.swipeChildren}
          containerStyle={styles.swipeContainer}
          dragOffsetFromLeftEdge={12}
          dragOffsetFromRightEdge={12}
          friction={1.8}
          leftThreshold={48}
          overshootLeft={false}
          overshootRight={false}
          ref={swipeableRef}
          renderRightActions={() => (
            <ThreadSwipeActions>
              <ThreadSwipeAction
                icon="push-pin"
                label={thread.pinned ? "Unpin" : "Pin"}
                tone="neutral"
                {...(onTogglePin === undefined
                  ? {}
                  : {
                      onPress: () => {
                        runThreadAction(onTogglePin, thread.pinned ? "Unpin" : "Pin", true);
                      },
                    })}
              />
              <ThreadSwipeAction
                icon="checkmark-done-outline"
                label="Read"
                tone="accent"
                {...(onMarkRead === undefined
                  ? {}
                  : {
                      onPress: () => {
                        runThreadAction(onMarkRead, "Mark as read", true);
                      },
                    })}
              />
              <ThreadSwipeAction
                icon={thread.archived === true ? "archive" : "archive-outline"}
                label={archiveLabel}
                tone={thread.archived === true ? "accent" : "danger"}
                {...(archiveAction === undefined
                  ? {}
                  : {
                      onPress: () => {
                        runThreadAction(archiveAction, archiveLabel, true);
                      },
                    })}
              />
            </ThreadSwipeActions>
          )}
          rightThreshold={48}
        >
          {rowMenu}
        </Swipeable>
      )}
      <ThreadRowWebMenu actions={actions} props={props} />
    </>
  );
}
