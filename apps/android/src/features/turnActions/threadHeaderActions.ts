import { useEvent } from "../../react/useEvent";
/** V1 ThreadActions owner, extracted without changing interaction or resource lifetime. */
import type { ActionMenuItem } from "../../ui/ActionMenu";
import { useAppDialog } from "../../ui/AppDialog";
import { copySessionId } from "./turnActions";

import type { ThreadHeaderProps } from "./threadHeaderContract";

export function useThreadHeaderActions({
  threadId,
  archived,
  pinned,
  onRenameRequest,
  onArchive,
  onUnarchive,
  onCompact,
  onFork,
  onDelete,
  onTogglePin,
}: ThreadHeaderProps) {
  const dialog = useAppDialog();
  const actions: ActionMenuItem[] = [
    { id: "copy-session-id", label: "Copy session ID", icon: "copy-outline" },
    { id: "rename", label: "Rename", icon: "pencil-outline" },
    {
      id: "pin",
      label: pinned ? "Unpin thread" : "Pin thread",
      icon: "pin-outline",
      selected: pinned,
      disabled: onTogglePin === undefined,
    },
    {
      id: "fork",
      label: "Fork thread",
      icon: "git-branch-outline",
      disabled: onFork === undefined,
    },
    {
      id: "compact",
      label: "Compact context",
      icon: "contract-outline",
      disabled: onCompact === undefined,
    },
    {
      id: "archive",
      label: archived ? "Unarchive thread" : "Archive thread",
      icon: archived ? "archive" : "archive-outline",
      disabled: archived ? onUnarchive === undefined : onArchive === undefined,
    },
    {
      id: "delete",
      label: "Delete thread",
      icon: "trash-outline",
      destructive: true,
      disabled: onDelete === undefined,
    },
  ];
  const run = useEvent((action: (() => Promise<void>) | undefined, label: string) => {
    if (action === undefined) return;
    void action().catch((cause) =>
      dialog.alert(
        `${label} failed`,
        cause instanceof Error ? cause.message : "Thread action failed",
      ),
    );
  });
  const handleAction = useEvent((id: string) => {
    if (id === "copy-session-id")
      void copySessionId(threadId).catch((cause) =>
        dialog.alert(
          "Copy failed",
          cause instanceof Error ? cause.message : "Could not copy session ID",
        ),
      );
    else if (id === "rename") onRenameRequest();
    else if (id === "pin") run(onTogglePin, pinned ? "Unpin" : "Pin");
    else if (id === "fork" && onFork !== undefined)
      run(() => onFork({ boundary: { kind: "all" }, ephemeral: false }), "Fork");
    else if (id === "compact") run(onCompact, "Compact");
    else if (id === "archive")
      run(archived ? onUnarchive : onArchive, archived ? "Unarchive" : "Archive");
    else if (id === "delete" && onDelete !== undefined) {
      dialog.alert(
        "Delete thread?",
        "This permanently deletes the thread on the selected server.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: () => run(onDelete, "Delete") },
        ],
      );
    }
  });

  return { actions, run, handleAction };
}
