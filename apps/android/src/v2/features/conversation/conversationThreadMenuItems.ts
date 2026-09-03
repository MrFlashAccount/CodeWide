import type { ActionMenuItem } from "../../ui/ActionMenu";

export function conversationThreadMenuItems(
  archived: boolean,
  pinned: boolean,
  pinPending: boolean,
  threadActionPending: boolean,
  live: boolean,
): ActionMenuItem[] {
  const commandDisabled = !live || threadActionPending;
  return [
    { icon: "copy-outline", id: "copy-session-id", label: "Copy session ID" },
    { disabled: commandDisabled, icon: "pencil-outline", id: "rename", label: "Rename" },
    {
      disabled: pinPending,
      icon: pinned ? "pin" : "pin-outline",
      id: "pin",
      label: pinned ? "Unpin thread" : "Pin thread",
      selected: pinned,
    },
    {
      disabled: commandDisabled,
      icon: "git-branch-outline",
      id: "fork",
      label: "Fork thread",
    },
    {
      disabled: commandDisabled,
      icon: "contract-outline",
      id: "compact",
      label: "Compact context",
    },
    {
      disabled: commandDisabled,
      icon: archived ? "archive" : "archive-outline",
      id: "archive",
      label: archived ? "Unarchive thread" : "Archive thread",
    },
    {
      destructive: true,
      disabled: commandDisabled,
      icon: "trash-outline",
      id: "delete",
      label: "Delete thread",
    },
  ];
}
