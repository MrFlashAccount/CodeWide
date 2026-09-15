import type { ThreadListMode } from "./threadListModel";
import type { ThreadListItem } from "./threadListTypes";

export type ThreadListFilter = "all" | "running" | "approval" | "unread" | "pinned";

export function threadFilterOptions(
  mode: ThreadListMode,
): ReadonlyArray<{ id: ThreadListFilter; label: string }> {
  if (mode === "archived")
    return [
      { id: "all", label: "All archived" },
      { id: "unread", label: "Unread" },
      { id: "pinned", label: "Pinned" },
    ];
  return [
    { id: "all", label: "All threads" },
    { id: "running", label: "Running" },
    { id: "approval", label: "Approval needed" },
    { id: "unread", label: "Unread" },
    { id: "pinned", label: "Pinned" },
  ];
}

export function effectiveThreadListFilter(
  mode: ThreadListMode,
  filter: ThreadListFilter,
): ThreadListFilter {
  return mode === "archived" && (filter === "running" || filter === "approval") ? "all" : filter;
}

export function threadFilterLabel(filter: ThreadListFilter, mode: ThreadListMode): string {
  return (
    threadFilterOptions(mode).find((option) => option.id === filter)?.label ??
    (mode === "archived" ? "All archived" : "All threads")
  );
}

export function threadMatchesFilter(thread: ThreadListItem, filter: ThreadListFilter): boolean {
  if (filter === "running") return thread.state === "running";
  if (filter === "approval") return thread.state === "approval";
  if (filter === "unread") return thread.unread > 0;
  if (filter === "pinned") return thread.pinned;
  return true;
}
