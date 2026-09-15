import type { ThreadListItem } from "../threadList/threadListTypes";

export function threadSelectionKey(thread: Pick<ThreadListItem, "id" | "serverId">): string {
  return `${thread.serverId}\u0000${thread.id}`;
}

export function parseThreadSelectionKey(
  value: string | null,
): { connectionId: string; threadId: string } | null {
  if (value === null) return null;
  const separator = value.indexOf("\u0000");
  if (separator <= 0 || separator === value.length - 1) return null;
  return { connectionId: value.slice(0, separator), threadId: value.slice(separator + 1) };
}
