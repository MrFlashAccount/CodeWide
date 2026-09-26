import { useRef, useState } from "react";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { useEvent } from "../../react/useEvent";
import type { ActionMenuItem } from "../../ui/ActionMenu";
import { useAppDialog } from "../../ui/AppDialog";
import type { ThreadRowProps } from "./threadRowContract";

const READ_ACTION = {
  read: { icon: "mail-unread-outline", label: "Mark as unread", swipeLabel: "Unread" },
  unread: { icon: "checkmark-done-outline", label: "Mark as read", swipeLabel: "Read" },
} as const;

export function useThreadRowActions({
  onArchive,
  onTogglePin,
  onToggleRead,
  onUnarchive,
  thread,
}: ThreadRowProps) {
  const dialog = useAppDialog();
  const swipeableRef = useRef<SwipeableMethods | null>(null);
  const [webContextVisible, setWebContextVisible] = useState(false);
  const archiveAction = thread.archived === true ? onUnarchive : onArchive;
  const archiveLabel = thread.archived === true ? "Unarchive" : "Archive";
  const readAction = thread.unread > 0 ? READ_ACTION.unread : READ_ACTION.read;
  const swipeEnabled =
    onTogglePin !== undefined || archiveAction !== undefined || onToggleRead !== undefined;
  const menuActions: ActionMenuItem[] = [
    { icon: "copy-outline", id: "copy-session-id", label: "Copy session ID" },
    {
      disabled: onTogglePin === undefined,
      icon: "pin-outline",
      id: "pin",
      label: thread.pinned ? "Unpin" : "Pin",
      selected: thread.pinned,
    },
    {
      disabled: onToggleRead === undefined,
      icon: readAction.icon,
      id: "read",
      label: readAction.label,
    },
    {
      destructive: thread.archived !== true,
      disabled: archiveAction === undefined,
      icon: thread.archived === true ? "archive" : "archive-outline",
      id: "archive",
      label: archiveLabel,
    },
  ];
  const runThreadAction = useEvent(
    (action: (() => Promise<void>) | undefined, label: string, closeSwipe: boolean = false) => {
      if (action === undefined) {
        return;
      }
      // Start the action before closing the animated row. A close failure must
      // never swallow the actual thread command.
      void action().catch((error: unknown) => {
        dialog.alert(
          `${label} failed`,
          error instanceof Error ? error.message : "Thread action failed",
        );
      });
      if (closeSwipe) {
        swipeableRef.current?.close();
      }
    },
  );
  const closeSwipe = useEvent(() => {
    swipeableRef.current?.close();
  });
  return {
    archiveAction,
    archiveLabel,
    closeSwipe,
    dialog,
    menuActions,
    readAction,
    runThreadAction,
    setWebContextVisible,
    swipeableRef,
    swipeEnabled,
    webContextVisible,
  };
}
/** Explicit actions exposed by the thread-row action owner. */
export type ThreadRowActions = ReturnType<typeof useThreadRowActions>;
