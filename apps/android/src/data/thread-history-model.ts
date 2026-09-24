import { observable, type Observable } from "@legendapp/state";

import { replaceEqualDeep } from "./replace-equal-deep";
import type { ThreadLoadStatus } from "./thread-load-status";
import type { ThreadHistoryState } from "./thread-pagination";

export type ThreadHistoryCursor = Omit<ThreadHistoryState, "status" | "error"> & {
  connectionId: string;
  id: string;
  threadId: string;
};

export type ThreadHistoryActivity = {
  error: string | null;
  status: ThreadLoadStatus;
};

export type ThreadHistoryRow = ThreadHistoryCursor &
  ThreadHistoryActivity & {
    updatedAt: number;
  };

export type ThreadHistoryModel = {
  activity$: (id: string) => Observable<ThreadHistoryActivity>;
  close: () => void;
  cursor$: (id: string) => Observable<ThreadHistoryCursor | null>;
  delete: (id: string) => void;
  forgetConnection: (connectionId: string) => void;
  get: (id: string) => ThreadHistoryRow | undefined;
  put: (row: Omit<ThreadHistoryRow, "updatedAt">) => void;
};

const IDLE_ACTIVITY: ThreadHistoryActivity = { error: null, status: "idle" };

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
    activity$,
    close() {
      closed = true;
      for (const node of cursors.values()) {
        node.set(null);
      }
      for (const node of activities.values()) {
        node.set(IDLE_ACTIVITY);
      }
      cursors.clear();
      activities.clear();
      updatedAt.clear();
    },
    cursor$,
    delete(id) {
      cursors.get(id)?.set(null);
      activities.get(id)?.set(IDLE_ACTIVITY);
      cursors.delete(id);
      activities.delete(id);
      updatedAt.delete(id);
    },
    forgetConnection(connectionId) {
      for (const id of cursors.keys()) {
        if (id.startsWith(`${connectionId}\u0000`)) {
          cursors.get(id)?.set(null);
          activities.get(id)?.set(IDLE_ACTIVITY);
          cursors.delete(id);
          activities.delete(id);
          updatedAt.delete(id);
        }
      }
      for (const id of activities.keys()) {
        if (id.startsWith(`${connectionId}\u0000`)) {
          activities.get(id)?.set(IDLE_ACTIVITY);
          activities.delete(id);
        }
      }
    },
    get(id) {
      const cursor = cursors.get(id)?.peek() ?? null;
      if (cursor === null) {
        return undefined;
      }
      return {
        ...cursor,
        ...(activities.get(id)?.peek() ?? IDLE_ACTIVITY),
        updatedAt: updatedAt.get(id) ?? 0,
      };
    },
    put(row) {
      if (closed) {
        return;
      }
      const { error, status, ...cursor } = row;
      const cursorNode = cursor$(row.id);
      const previousCursor = cursorNode.peek();
      const nextCursor =
        previousCursor === null ? cursor : replaceEqualDeep(previousCursor, cursor);
      if (nextCursor !== previousCursor) {
        cursorNode.set(nextCursor);
      }

      const activityNode = activity$(row.id);
      const previousActivity = activityNode.peek();
      const nextActivity = replaceEqualDeep(previousActivity, { error, status });
      if (nextActivity !== previousActivity) {
        activityNode.set(nextActivity);
      }

      updatedAt.set(row.id, Date.now());
      prune();
    },
  };
}
