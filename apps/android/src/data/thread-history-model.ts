import { observable, type Observable } from "@legendapp/state";

import { replaceEqualDeep } from "./replace-equal-deep";
import type { ThreadLoadStatus } from "./thread-load-status";
import type { ThreadHistoryState } from "./thread-pagination";

export type ThreadHistoryCursor = Omit<ThreadHistoryState, "status" | "error"> & {
  id: string;
  connectionId: string;
  threadId: string;
  generation: number;
};

export type ThreadHistoryActivity = {
  status: ThreadLoadStatus;
  error: string | null;
};

export type ThreadHistoryRow = ThreadHistoryCursor & ThreadHistoryActivity & {
  updatedAt: number;
};

export type ThreadHistoryModel = {
  cursor$(id: string): Observable<ThreadHistoryCursor | null>;
  activity$(id: string): Observable<ThreadHistoryActivity>;
  get(id: string): ThreadHistoryRow | undefined;
  put(row: Omit<ThreadHistoryRow, "updatedAt">): void;
  delete(id: string): void;
  close(): void;
};

const IDLE_ACTIVITY: ThreadHistoryActivity = { status: "idle", error: null };

/** Keeps the remote cursor and transport activity in separate Legend nodes.
 * SQLite window membership belongs to ThreadChatModel and never passes through
 * this transport model. */
export function createThreadHistoryModel(maxResidentRows = 72): ThreadHistoryModel {
  const cursors = new Map<string, Observable<ThreadHistoryCursor | null>>();
  const activities = new Map<string, Observable<ThreadHistoryActivity>>();
  const updatedAt = new Map<string, number>();
  let closed = false;

  const cursor$ = (id: string): Observable<ThreadHistoryCursor | null> => {
    let node = cursors.get(id);
    if (node === undefined) {
      node = observable<ThreadHistoryCursor | null>(null);
      cursors.set(id, node);
    }
    return node;
  };

  const activity$ = (id: string): Observable<ThreadHistoryActivity> => {
    let node = activities.get(id);
    if (node === undefined) {
      node = observable<ThreadHistoryActivity>(IDLE_ACTIVITY);
      activities.set(id, node);
    }
    return node;
  };

  const prune = (): void => {
    const overflow = [...updatedAt]
      .sort((left, right) => left[1] - right[1])
      .slice(0, Math.max(0, updatedAt.size - maxResidentRows));
    for (const [id] of overflow) {
      cursors.get(id)?.set(null);
      activities.get(id)?.set(IDLE_ACTIVITY);
      cursors.delete(id);
      activities.delete(id);
      updatedAt.delete(id);
    }
  };

  return {
    cursor$,
    activity$,
    get(id) {
      const cursor = cursors.get(id)?.peek() ?? null;
      if (cursor === null) return undefined;
      return {
        ...cursor,
        ...(activities.get(id)?.peek() ?? IDLE_ACTIVITY),
        updatedAt: updatedAt.get(id) ?? 0,
      };
    },
    put(row) {
      if (closed) return;
      const {
        status,
        error,
        ...cursor
      } = row;
      const cursorNode = cursor$(row.id);
      const previousCursor = cursorNode.peek();
      const nextCursor = previousCursor === null ? cursor : replaceEqualDeep(previousCursor, cursor);
      if (nextCursor !== previousCursor) cursorNode.set(nextCursor);

      const activityNode = activity$(row.id);
      const previousActivity = activityNode.peek();
      const nextActivity = replaceEqualDeep(previousActivity, { status, error });
      if (nextActivity !== previousActivity) activityNode.set(nextActivity);

      updatedAt.set(row.id, Date.now());
      prune();
    },
    delete(id) {
      cursors.get(id)?.set(null);
      activities.get(id)?.set(IDLE_ACTIVITY);
      cursors.delete(id);
      activities.delete(id);
      updatedAt.delete(id);
    },
    close() {
      closed = true;
      for (const node of cursors.values()) node.set(null);
      for (const node of activities.values()) node.set(IDLE_ACTIVITY);
      cursors.clear();
      activities.clear();
      updatedAt.clear();
    },
  };
}
