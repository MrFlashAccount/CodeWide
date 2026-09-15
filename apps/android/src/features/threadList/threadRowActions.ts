import { useRef, useState } from "react";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { useEvent } from "../../react/useEvent";
import type { ActionMenuItem } from "../../ui/ActionMenu";
import { useAppDialog } from "../../ui/AppDialog";
import type { ThreadRowProps } from "./threadRowContract";
export function useThreadRowActions({
  thread,
  onTogglePin,
  onArchive,
  onUnarchive,
  onMarkRead,
}: ThreadRowProps) {
  const dialog = useAppDialog();
  const swipeableRef = useRef<SwipeableMethods | null>(null);
  const [webContextVisible, setWebContextVisible] = useState(false);
  const archiveAction = thread.archived ? onUnarchive : onArchive;
  const archiveLabel = thread.archived ? "Unarchive" : "Archive";
  const swipeEnabled =
    onTogglePin !== undefined || archiveAction !== undefined || onMarkRead !== undefined;
  const menuActions: ActionMenuItem[] = [
    { id: "copy-session-id", label: "Copy session ID", icon: "copy-outline" },
    {
      id: "pin",
      label: thread.pinned ? "Unpin" : "Pin",
      icon: "pin-outline",
      selected: thread.pinned,
      disabled: onTogglePin === undefined,
    },
    {
      id: "read",
      label: "Mark as read",
      icon: "checkmark-done-outline",
      disabled: onMarkRead === undefined,
    },
    {
      id: "archive",
      label: archiveLabel,
      icon: thread.archived ? "archive" : "archive-outline",
      destructive: !thread.archived,
      disabled: archiveAction === undefined,
    },
  ];
  const runThreadAction = useEvent(
    (action: (() => Promise<void>) | undefined, label: string, closeSwipe = false) => {
      if (action === undefined) return;
      // Start the action before closing the animated row. A close failure must
      // never swallow the actual thread command.
      void action().catch((cause) =>
        dialog.alert(
          `${label} failed`,
          cause instanceof Error ? cause.message : "Thread action failed",
        ),
      );
      if (closeSwipe) swipeableRef.current?.close();
    },
  );
  const closeSwipe = useEvent(() => {
    swipeableRef.current?.close();
  });
  return {
    dialog,
    swipeableRef,
    webContextVisible,
    setWebContextVisible,
    archiveAction,
    archiveLabel,
    swipeEnabled,
    menuActions,
    runThreadAction,
    closeSwipe,
  };
}
export type ThreadRowActions = ReturnType<typeof useThreadRowActions>;
