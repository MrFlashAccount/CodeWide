import type { StoredThreadSummary } from "../../data/thread-summary-types";
import { serverScopeIncludes, type ServerScope } from "../../services/servers/serverScope";
import type { ThreadListItem } from "./threadListTypes";

export class ThreadListItemProjection {
  #source: readonly StoredThreadSummary[] | null = null;
  #value: ThreadListItem[] = [];

  project(source: readonly StoredThreadSummary[]): ThreadListItem[] {
    if (source === this.#source) {
      return this.#value;
    }
    this.#source = source;
    this.#value = source.map(storedThreadToListItem);
    return this.#value;
  }
}

export class ThreadListScopeProjection {
  #source: readonly ThreadListItem[] | null = null;
  #scope: ServerScope | null = null;
  #value: {
    active: ThreadListItem[];
    archived: ThreadListItem[];
    scoped: readonly ThreadListItem[];
  } = {
    active: [],
    archived: [],
    scoped: [],
  };

  project(
    source: readonly ThreadListItem[],
    scope: ServerScope,
  ): {
    active: ThreadListItem[];
    archived: ThreadListItem[];
    scoped: readonly ThreadListItem[];
  } {
    const previousScope = this.#scope;
    if (
      source === this.#source &&
      previousScope?.kind === scope.kind &&
      (scope.kind === "all" ||
        (previousScope.kind === "connection" && previousScope.connectionId === scope.connectionId))
    ) {
      return this.#value;
    }
    this.#source = source;
    this.#scope = scope;
    const scoped = source.filter((thread) => serverScopeIncludes(scope, thread.serverId));
    this.#value = {
      active: scoped.filter((thread) => thread.archived !== true),
      archived: scoped.filter((thread) => thread.archived === true),
      scoped,
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
  for (const row of rows) {
    byKey.set(`${row.connectionId}\u0000${row.remoteThreadId}`, row);
  }
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
    archived: thread.archived,
    id: thread.remoteThreadId,
    pinned: thread.pinned,
    preview: thread.preview,
    serverId: thread.connectionId,
    timestamp: thread.recencyAt ?? thread.updatedAt,
    title: thread.name ?? firstLine(thread.preview) ?? "New Chat",
    unread: thread.unread,
    ...(state === null ? {} : { state }),
  };
}
