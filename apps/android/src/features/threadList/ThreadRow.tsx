import type { ComponentProps } from "react";
import { AppLink } from "../../ui/AppLink";
import { useThreadRowActions } from "./threadRowActions";
import { ThreadRowContent } from "./ThreadRowContent";
import type { ThreadRowProps } from "./threadRowContract";
import { ThreadRowWebMenu } from "./ThreadRowWebMenu";
import { Pressable as GesturePressable } from "react-native-gesture-handler";
import Swipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import { useEvent } from "../../react/useEvent";
import { ThreadRowMenu } from "./ThreadRowMenu";
import { CommitOnChangeProbe } from "../../ui/CommitProbe";
import { ThreadRowCommitBoundary } from "../diagnostics/ThreadNavigationCommit";
import { copySessionId } from "../turnActions/turnActions";
import { styles } from "./ThreadRow.styles";
import { ThreadSwipeAction, ThreadSwipeActions } from "./ThreadSwipeActions";

export function ThreadRow(props: ThreadRowProps) {
  const { onMarkRead, onNavigate, onTogglePin, selected, server, thread } = props;
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

  const press = useEvent(() => {
    swipeableRef.current?.close();
    onNavigate();
  });
  const openWebMenu = useEvent(() => {
    setWebContextVisible(true);
  });
  const selectMenuAction = useEvent((id: string) => {
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
  });
  const rowKey = `${thread.serverId}:${thread.id}`;
  const rowMenu = (
    <ThreadRowMenu actions={menuActions} key={rowKey} onSelect={selectMenuAction} rowKey={rowKey}>
      {(openNativeMenu) => (
        <AppLink {...props.link}>
          <ThreadRowLinkTrigger
            accessibilityLabel="Thread actions"
            {...(selected ? { testID: "selected-thread-row" } : {})}
            accessibilityRole="link"
            cancelable
            delayLongPress={350}
            onLongPress={openNativeMenu ?? openWebMenu}
            onPress={press}
            selected={selected}
            swipeEnabled={swipeEnabled}
          >
            <ThreadRowContent selected={selected} server={server} thread={thread} />
          </ThreadRowLinkTrigger>
        </AppLink>
      )}
    </ThreadRowMenu>
  );
  return (
    <ThreadRowCommitBoundary>
      <CommitOnChangeProbe onCommit={closeSwipe} revision={selected ? 1 : 0} scope={thread.id} />
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
    </ThreadRowCommitBoundary>
  );
}

// Expo Link's Slot merges style objects. Keep the functional pressed style below that boundary.
function ThreadRowLinkTrigger({
  selected,
  swipeEnabled,
  ...props
}: ComponentProps<typeof GesturePressable> & {
  readonly selected: boolean;
  readonly swipeEnabled: boolean;
}): React.JSX.Element {
  return (
    <GesturePressable
      {...props}
      style={({ pressed }) => [
        styles.threadRow,
        swipeEnabled && styles.threadRowSwipeChild,
        selected && styles.threadRowSelected,
        pressed && styles.pressed,
      ]}
    />
  );
}
