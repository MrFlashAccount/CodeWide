import type { ThreadListFilter, ThreadListRow } from "./threadListTypes";

export function isThreadListFilter(value: string): value is ThreadListFilter {
  return (
    value === "all" ||
    value === "approval" ||
    value === "pinned" ||
    value === "running" ||
    value === "unread"
  );
}

export function threadMatchesFilter(row: ThreadListRow, filter: ThreadListFilter): boolean {
  if (filter === "running") return row.state === "running";
  if (filter === "approval") {
    return row.state === "waitingForApproval" || row.state === "waitingForInput";
  }
  if (filter === "unread") return row.unread > 0;
  if (filter === "pinned") return row.pinned === true;
  return true;
}

export function threadMatchesQuery(row: ThreadListRow, normalizedQuery: string): boolean {
  if (normalizedQuery === "") return true;
  if (row.authoritativeSearchMatch === true) return true;
  return `${row.title} ${row.preview ?? ""} ${row.id}`
    .toLocaleLowerCase()
    .includes(normalizedQuery);
}
