import type { StoredThreadSummary } from "../../data/thread-summary-types";
import { ALL_SERVERS_ID } from "../navigation/serverSelection";
import type { ThreadListItem } from "./threadListTypes";

export class ThreadListItemProjection {
  #source: readonly StoredThreadSummary[] | null = null;
  #value: ThreadListItem[] = [];

  project(source: readonly StoredThreadSummary[]): ThreadListItem[] {
    if (source === this.#source) return this.#value;
    this.#source = source;
    this.#value = source.map(storedThreadToListItem);
    return this.#value;
  }
}

export class ThreadListScopeProjection {
  #source: readonly ThreadListItem[] | null = null;
  #serverId = "";
  #value: {
    scoped: readonly ThreadListItem[];
    active: ThreadListItem[];
    archived: ThreadListItem[];
  } = {
    scoped: [],
    active: [],
    archived: [],
  };

  project(
    source: readonly ThreadListItem[],
    serverId: string,
  ): {
    scoped: readonly ThreadListItem[];
    active: ThreadListItem[];
    archived: ThreadListItem[];
  } {
    if (source === this.#source && serverId === this.#serverId) return this.#value;
    this.#source = source;
    this.#serverId = serverId;
    const scoped =
      serverId === ALL_SERVERS_ID
        ? source
        : source.filter((thread) => thread.serverId === serverId);
    this.#value = {
      scoped,
      active: scoped.filter((thread) => !thread.archived),
      archived: scoped.filter((thread) => thread.archived),
    };
    return this.#value;
  }
}

export function firstLine(value: string): string | null {
  const line = value.trim().split("\n")[0]?.trim();
  return line === undefined || line === "" ? null : line.slice(0, 80);
}

export function deduplicateThreadSummaries(
  rows: readonly StoredThreadSummary[],
): StoredThreadSummary[] {
  const byKey = new Map<string, StoredThreadSummary>();
  for (const row of rows) byKey.set(`${row.connectionId}\u0000${row.remoteThreadId}`, row);
  return [...byKey.values()];
}

export function storedThreadToListItem(thread: StoredThreadSummary): ThreadListItem {
  const state =
    thread.pendingRequestCount > 0
      ? "approval"
      : thread.status.type === "active"
        ? "running"
        : thread.status.type === "systemError"
          ? "failed"
          : null;
  return {
    id: thread.remoteThreadId,
    serverId: thread.connectionId,
    title: thread.name ?? firstLine(thread.preview) ?? "New Chat",
    preview: thread.preview,
    timestamp: thread.recencyAt ?? thread.updatedAt,
    pinned: thread.pinned,
    archived: thread.archived,
    unread: thread.unread,
    ...(state === null ? {} : { state }),
  };
}
