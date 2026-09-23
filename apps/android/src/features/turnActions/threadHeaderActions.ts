import { useEvent } from "../../react/useEvent";
/** V1 ThreadActions owner, extracted without changing interaction or resource lifetime. */
import type { ActionMenuItem } from "../../ui/ActionMenu";
import { useAppDialog } from "../../ui/AppDialog";
import { useAppNotice } from "../../ui/useAppNotice";
import { copySessionId } from "./turnActions";

import type { ThreadHeaderProps } from "./threadHeaderContract";

export function useThreadHeaderActions({
  archived,
  onArchive,
  onCompact,
  onDelete,
  onFork,
  onRenameRequest,
  onTogglePin,
  onUnarchive,
  pinned,
  threadId,
}: ThreadHeaderProps) {
  const dialog = useAppDialog();
  const showNotice = useAppNotice().show;
  const actions: ActionMenuItem[] = [
    { icon: "copy-outline", id: "copy-session-id", label: "Copy session ID" },
    { icon: "pencil-outline", id: "rename", label: "Rename" },
    {
      disabled: onTogglePin === undefined,
      icon: "pin-outline",
      id: "pin",
      label: pinned ? "Unpin thread" : "Pin thread",
      selected: pinned,
    },
    {
      disabled: onFork === undefined,
      icon: "git-branch-outline",
      id: "fork",
      label: "Fork thread",
    },
    {
      disabled: onCompact === undefined,
      icon: "contract-outline",
      id: "compact",
      label: "Compact context",
    },
    {
      disabled: archived ? onUnarchive === undefined : onArchive === undefined,
      icon: archived ? "archive" : "archive-outline",
      id: "archive",
      label: archived ? "Unarchive thread" : "Archive thread",
    },
    {
      destructive: true,
      disabled: onDelete === undefined,
      icon: "trash-outline",
      id: "delete",
      label: "Delete thread",
    },
  ];
  const run = useEvent((action: (() => Promise<void>) | undefined, label: string) => {
    if (action === undefined) {
      return;
    }
    void action().catch((error: unknown) => {
      dialog.alert(
        `${label} failed`,
        error instanceof Error ? error.message : "Thread action failed",
      );
    });
  });
  const handleAction = useEvent((id: string) => {
    if (id === "copy-session-id") {
      void copySessionId(threadId, showNotice).catch((error: unknown) => {
        dialog.alert(
          "Copy failed",
          error instanceof Error ? error.message : "Could not copy session ID",
        );
      });
    } else if (id === "rename") {
      onRenameRequest();
    } else if (id === "pin") {
      run(onTogglePin, pinned ? "Unpin" : "Pin");
    } else if (id === "fork" && onFork !== undefined) {
      run(async () => onFork({ boundary: { kind: "all" }, ephemeral: false }), "Fork");
    } else if (id === "compact") {
      run(onCompact, "Compact");
    } else if (id === "archive") {
      run(archived ? onUnarchive : onArchive, archived ? "Unarchive" : "Archive");
    } else if (id === "delete" && onDelete !== undefined) {
      dialog.alert(
        "Delete thread?",
        "This permanently deletes the thread on the selected server.",
        [
          { style: "cancel", text: "Cancel" },
          {
            onPress: () => {
              run(onDelete, "Delete");
            },
            style: "destructive",
            text: "Delete",
          },
        ],
      );
    }
  });

  return { actions, handleAction, run };
}
