import type { ActionMenuItem } from "../../ui/ActionMenu";
import type { ThreadListRow, ThreadListRowActions } from "./threadListTypes";

export type ThreadListRowAction = "archive" | "copy" | "markRead" | "togglePin";

export function isThreadListRowAction(value: string): value is ThreadListRowAction {
  return value === "archive" || value === "copy" || value === "markRead" || value === "togglePin";
}

export function resolveThreadListRowAction(
  actions: ThreadListRowActions,
  row: ThreadListRow,
  kind: ThreadListRowAction,
): (() => Promise<void>) | null {
  if (kind === "copy") return () => actions.copyId(row.id);
  if (kind === "togglePin") return () => actions.togglePin(row.id, row.pinned !== true);
  if (row.retained) return null;
  if (kind === "archive") return () => actions.archive(row.id, row.archived !== true);
  const marker = row.latestActivityMarker;
  if (row.unread === 0 || marker === null) return null;
  return () => actions.markRead(row.id, marker);
}

export function threadListRowActionMenu(row: ThreadListRow, pending: boolean): ActionMenuItem[] {
  const remoteDisabled = pending || row.retained;
  return [
    { disabled: pending, icon: "copy-outline", id: "copy", label: "Copy session ID" },
    {
      disabled: pending,
      icon: row.pinned === true ? "pin" : "pin-outline",
      id: "togglePin",
      label: row.pinned === true ? "Unpin" : "Pin",
      selected: row.pinned === true,
    },
    {
      disabled: remoteDisabled || row.unread === 0 || row.latestActivityMarker === null,
      icon: "checkmark-done-outline",
      id: "markRead",
      label: "Mark as read",
    },
    {
      disabled: remoteDisabled,
      icon: row.archived === true ? "archive" : "archive-outline",
      id: "archive",
      label: row.archived === true ? "Unarchive" : "Archive",
    },
  ];
}

export function threadListActionPendingLabel(action: ThreadListRowAction): string {
  if (action === "copy") return "Copying…";
  if (action === "markRead") return "Marking as read…";
  if (action === "togglePin") return "Updating pin…";
  return "Updating archive…";
}

function threadListRowStateLabel(state: string, retained: boolean): string {
  const source = retained ? "Cached" : "Live";
  if (state === "running") return `${source} · Running`;
  if (state === "waitingForApproval") return `${source} · Approval needed`;
  if (state === "waitingForInput") return `${source} · Waiting for input`;
  if (state === "failed") return `${source} · Failed`;
  return source;
}

export function threadListRowPreview(row: ThreadListRow): string {
  const state = threadListRowStateLabel(row.state, row.retained);
  if (row.preview === undefined || row.preview === "") return state;
  return row.preview;
}

export function threadListRowAccessibilityStatus(row: ThreadListRow): string | undefined {
  if (row.state === "waitingForApproval") return "Approval needed";
  if (row.state === "waitingForInput") return "Waiting for input";
  if (row.state === "failed") return "Failed";
  return undefined;
}
