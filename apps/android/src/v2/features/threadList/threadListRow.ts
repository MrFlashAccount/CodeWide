import type { V2ThreadSummary } from "@codewide/sync-client/v2";

import type { ThreadListRow } from "../../presentation/navigation/threadListTypes";
import type { ThreadId } from "../../domain/ids";
import { threadListCopy } from "./threadListPresentation";

interface ThreadListRowInput {
  displayId?: string;
  pinned: boolean;
  retained: boolean;
  thread: V2ThreadSummary;
}

export function presentThreadListRow(input: ThreadListRowInput): ThreadListRow {
  const { displayId, pinned, retained, thread } = input;
  const copy = threadListCopy(thread);
  const unread = thread.readState.kind === "unread" ? thread.readState.unreadCount : 0;
  return {
    archived: thread.archived,
    id: displayId ?? thread.id,
    latestActivityMarker:
      thread.readState.kind === "unread" ? thread.readState.latestActivityMarker : null,
    pinned,
    preview: copy.preview,
    retained,
    state: thread.state,
    title: copy.title,
    unread,
    updatedAt: formatThreadTime(thread.lastActivityAt ?? thread.updatedAt),
  };
}

export function threadIsPinned(pins: ReadonlySet<ThreadId> | undefined, id: ThreadId): boolean {
  return pins?.has(id) === true;
}

function formatThreadTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
