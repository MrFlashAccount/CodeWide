import type { CodeWideMenuAction } from "./CodeWideMenu.native";
import type { MessageActionMenuRequest } from "./MessageActionMenu.types";

export function messageActionMenuItems(
  request: MessageActionMenuRequest | undefined,
): readonly CodeWideMenuAction[] {
  return [
    {
      disabled: request === undefined || request.copyText === "",
      icon: "copy-outline",
      id: "copy",
      label: "Copy",
    },
    {
      disabled: request?.onEdit === undefined,
      icon: "create-outline",
      id: "edit",
      label: "Edit message",
    },
    {
      disabled: request?.onFork === undefined,
      icon: "git-branch-outline",
      id: "fork",
      label: "Fork",
    },
    {
      destructive: true,
      disabled: request?.onRollback === undefined,
      icon: "arrow-undo-outline",
      id: "rollback",
      label: "Roll back to here",
    },
    {
      disabled: request?.onReview === undefined,
      icon: "chatbubble-ellipses-outline",
      id: "review",
      label: "Review response",
    },
    {
      destructive: true,
      disabled: request?.onInterrupt === undefined,
      icon: "stop-circle-outline",
      id: "interrupt",
      label: "Stop response",
    },
  ];
}
