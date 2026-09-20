import type {
  LoadedThreadSummaryView,
  ThreadSummaryViewRequest,
} from "./thread-summary-view-types";

export type {
  LoadedThreadSummaryView,
  ThreadSummaryViewRequest,
} from "./thread-summary-view-types";
import { batch, observable, opaqueObject, type Observable } from "@legendapp/state";

import { replaceEqualDeep } from "./replace-equal-deep";
import { observablePromise } from "./observablePromise";
import { threadSummaryKey } from "./thread-summary-projection";
import type { StoredThreadSummary } from "./thread-summary-types";
import { updateThreadSummaryView, reprojectThreadSummaryChanges } from "./thread-summary-view";

export { projectThreadSummaryView } from "./thread-summary-view";

export type ThreadSummaryViewSnapshot = LoadedThreadSummaryView & {
  error: string | null;
  phase: "idle" | "loading" | "ready" | "error";
  requestKey: string | null;
  revision: number;
};

export type ThreadSummaryModel = {
  activeRequests: () => readonly ThreadSummaryViewRequest[];
  close: () => void;
  commitView: (
    request: ThreadSummaryViewRequest,
    generation: number,
    loaded: LoadedThreadSummaryView,
  ) => boolean;
  failView: (request: ThreadSummaryViewRequest, generation: number, cause: unknown) => void;
  publish: (
    changes: readonly (
      | { type: "insert" | "update"; value: StoredThreadSummary }
      | { key: string; type: "delete" }
    )[],
  ) => void;
  resource: (
    request: ThreadSummaryViewRequest,
    loader: () => Promise<LoadedThreadSummaryView>,
  ) => ThreadSummaryViewResource;
  retainView: (request: Pick<ThreadSummaryViewRequest, "viewId" | "connectionId">) => () => void;
  startView: (request: ThreadSummaryViewRequest) => number;
  view$: (request: ThreadSummaryViewRequest) => Observable<ThreadSummaryViewSnapshot>;
};

export type ThreadSummaryViewResource = {
  ready$: Observable<boolean>;
  view$: Observable<ThreadSummaryViewSnapshot>;
};

type ThreadSummaryResourceRecord = {
  generation: number;
  hasReadySnapshot: boolean;
  initialFailed: boolean;
  loadingRevision: string | null;
  pendingChanges: Array<
    { type: "insert" | "update"; value: StoredThreadSummary } | { key: string; type: "delete" }
  >;
  ready$: Observable<boolean> | null;
  requestRevision: string;
  retryAttempt: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
};

export function createThreadSummaryModel(): ThreadSummaryModel {
  const views = new Map<string, Observable<ThreadSummaryViewSnapshot>>();
  const requests = new Map<string, ThreadSummaryViewRequest>();
  const generations = new Map<string, number>();
  const retainCounts = new Map<string, number>();
  const resources = new Map<string, ThreadSummaryResourceRecord>();
  let closed = false;

  // Views are atomic snapshots: consumers subscribe to the root, and this owner
  // retains unchanged row identities. Deep observable traversal would compare
  // every field of every shifted row when recency moves a chat to the front.
  const view$ = (request: ThreadSummaryViewRequest): Observable<ThreadSummaryViewSnapshot> => {
    const key = threadSummaryViewKey(request);
    let node = views.get(key);
    if (node === undefined) {
      node = observable<ThreadSummaryViewSnapshot>(opaqueObject(emptyThreadSummaryView()));
      views.set(key, node);
    }
    return node;
  };

  const evict = (key: string): void => {
    const resource = resources.get(key);
    if (resource?.retryTimer !== null && resource?.retryTimer !== undefined) {
      clearTimeout(resource.retryTimer);
    }
    views.delete(key);
    resources.delete(key);
    requests.delete(key);
    generations.delete(key);
    retainCounts.delete(key);
  };

  const beginResourceLoad = async (
    request: ThreadSummaryViewRequest,
    loader: () => Promise<LoadedThreadSummaryView>,
    initial: boolean,
    retryAttempt = 0,
  ): Promise<boolean> => {
    const key = threadSummaryViewKey(request);
    const requestRevision = threadSummaryViewRequestKey(request);
    const generation = (generations.get(key) ?? 0) + 1;
    generations.set(key, generation);
    requests.set(key, request);
    const record = resources.get(key);
    if (record !== undefined) {
      if (record.retryTimer !== null) {
        clearTimeout(record.retryTimer);
      }
      record.retryTimer = null;
      record.requestRevision = requestRevision;
      record.loadingRevision = requestRevision;
      record.generation = generation;
      record.initialFailed = false;
      record.retryAttempt = retryAttempt;
    }
    return Promise.resolve()
      .then(loader)
      .then((loaded) => {
        const current = resources.get(key);
        if (
          closed ||
          current === undefined ||
          current.generation !== generation ||
          current.requestRevision !== requestRevision
        ) {
          return false;
        }
        const projected = reprojectThreadSummaryChanges(loaded, current.pendingChanges, request);
        current.pendingChanges = [];
        current.loadingRevision = null;
        current.hasReadySnapshot = true;
        current.retryAttempt = 0;
        const node = view$(request);
        const previous = node.peek();
        const content = reconcileSummaryContent(previous, projected);
        const contentChanged = summaryContentChanged(previous, content);
        const next = replaceEqualDeep<ThreadSummaryViewSnapshot>(previous, {
          error: null,
          phase: "ready",
          requestKey: requestRevision,
          ...content,
          revision: previous.revision + (contentChanged ? 1 : 0),
        });
        if (next !== previous) {
          node.set(opaqueObject(next));
        }
        return true;
      })
      .catch((error: unknown) => {
        const current = resources.get(key);
        const ownsLoad =
          !closed &&
          current !== undefined &&
          current.generation === generation &&
          current.requestRevision === requestRevision;
        if (!ownsLoad) {
          return false;
        }
        current.loadingRevision = null;
        current.initialFailed = initial;
        const node = view$(request);
        const previous = node.peek();
        node.set(
          opaqueObject<ThreadSummaryViewSnapshot>({
            ...previous,
            error: error instanceof Error ? error.message : "Could not load chats",
            phase: hasSummaryRows(previous) ? "ready" : "error",
          }),
        );
        if (initial) {
          throw error;
        }
        const retryDelay = Math.min(250 * 2 ** current.retryAttempt, 5000);
        current.retryTimer = setTimeout(() => {
          const latest = resources.get(key);
          if (
            closed ||
            latest !== current ||
            latest.requestRevision !== requestRevision ||
            latest.loadingRevision !== null
          ) {
            return;
          }
          beginResourceLoad(request, loader, false, current.retryAttempt + 1).catch(() => false);
        }, retryDelay);
        return false;
      });
  };

  return {
    activeRequests() {
      return [...requests.values()];
    },
    close() {
      closed = true;
      for (const resource of resources.values()) {
        if (resource.retryTimer !== null) {
          clearTimeout(resource.retryTimer);
        }
      }
      views.clear();
      resources.clear();
      requests.clear();
      generations.clear();
      retainCounts.clear();
    },
    commitView(request, generation, loaded) {
      const key = threadSummaryViewKey(request);
      if (closed || generations.get(key) !== generation) {
        return false;
      }
      const node = view$(request);
      const previous = node.peek();
      const content = reconcileSummaryContent(previous, loaded);
      const contentChanged = summaryContentChanged(previous, content);
      const next = replaceEqualDeep<ThreadSummaryViewSnapshot>(previous, {
        error: null,
        phase: "ready",
        requestKey: threadSummaryViewRequestKey(request),
        ...content,
        revision: previous.revision + (contentChanged ? 1 : 0),
      });
      if (next !== previous) {
        node.set(opaqueObject(next));
      }
      return true;
    },
    failView(request, generation, cause) {
      const key = threadSummaryViewKey(request);
      if (closed || generations.get(key) !== generation) {
        return;
      }
      const node = view$(request);
      const previous = node.peek();
      const next = replaceEqualDeep<ThreadSummaryViewSnapshot>(previous, {
        ...previous,
        error: cause instanceof Error ? cause.message : "Could not load chats",
        phase: hasSummaryRows(previous) ? "ready" : "error",
      });
      if (next !== previous) {
        node.set(opaqueObject(next));
      }
    },
    publish(changes) {
      if (closed || changes.length === 0) {
        return;
      }
      batch(() => {
        for (const [key, node] of views) {
          const request = requests.get(key);
          if (request === undefined) {
            continue;
          }
          const resource = resources.get(key);
          if (resource !== undefined && resource.loadingRevision !== null) {
            resource.pendingChanges.push(...changes);
          }
          const previous = node.peek();
          // A pending request can change membership before its replacement rows
          // arrive. Reproject that transition; settled views consume only deltas.
          const content =
            (resource?.loadingRevision !== null && resource?.loadingRevision !== undefined) ||
            previous.requestKey !== threadSummaryViewRequestKey(request)
              ? reconcileSummaryContent(
                  previous,
                  reprojectThreadSummaryChanges(previous, changes, request),
                )
              : updateThreadSummaryView(previous, changes, request);
          if (!summaryContentChanged(previous, content)) {
            continue;
          }
          node.set(
            opaqueObject<ThreadSummaryViewSnapshot>({
              ...previous,
              ...content,
              revision: previous.revision + 1,
            }),
          );
        }
      });
    },
    resource(request, loader) {
      if (closed) {
        throw new Error("Thread summary model is closed");
      }
      const key = threadSummaryViewKey(request);
      const requestRevision = threadSummaryViewRequestKey(request);
      const previousRequest = requests.get(key);
      let record = resources.get(key);
      if (record === undefined) {
        // Register the record before the Promise can settle so synchronous test
        // loaders and cached native reads still commit into the owned resource.
        const holder: ThreadSummaryResourceRecord = {
          generation: 0,
          hasReadySnapshot: false,
          initialFailed: false,
          loadingRevision: requestRevision,
          pendingChanges: [],
          ready$: null,
          requestRevision,
          retryAttempt: 0,
          retryTimer: null,
        };
        resources.set(key, holder);
        holder.ready$ = observablePromise(beginResourceLoad(request, loader, true));
        holder.generation = generations.get(key) ?? 0;
        record = holder;
      } else if (record.initialFailed && record.loadingRevision === null) {
        record.ready$ = observablePromise(beginResourceLoad(request, loader, true));
      } else if (
        record.requestRevision !== requestRevision &&
        record.loadingRevision !== requestRevision
      ) {
        // A larger list range or a changed selected/subagent projection keeps
        // the complete resident snapshot visible. Only the atomic replacement
        // is published when the new SQLite range is ready.
        const blocksNavigation =
          !record.hasReadySnapshot ||
          !summaryViewSatisfiesVisiblePartition(previousRequest, request) ||
          !summaryViewSatisfiesSelection(view$(request).peek(), request);
        const load = beginResourceLoad(request, loader, blocksNavigation);
        if (blocksNavigation) {
          record.ready$ = observablePromise(load);
        } else {
          load.catch(() => false);
        }
      }
      if (record.ready$ === null) {
        throw new Error("Thread summary readiness was not initialized");
      }
      return { ready$: record.ready$, view$: view$(request) };
    },
    retainView(request) {
      if (closed) {
        return () => undefined;
      }
      const key = `${request.viewId ?? "default"}\u0000${request.connectionId ?? "*"}`;
      retainCounts.set(key, (retainCounts.get(key) ?? 0) + 1);
      let retained = true;
      return () => {
        if (!retained) {
          return;
        }
        retained = false;
        const next = (retainCounts.get(key) ?? 1) - 1;
        if (next <= 0) {
          evict(key);
        } else {
          retainCounts.set(key, next);
        }
      };
    },
    startView(request) {
      if (closed) {
        throw new Error("Thread summary model is closed");
      }
      const key = threadSummaryViewKey(request);
      const generation = (generations.get(key) ?? 0) + 1;
      generations.set(key, generation);
      requests.set(key, request);
      const node = view$(request);
      const previous = node.peek();
      const next = replaceEqualDeep<ThreadSummaryViewSnapshot>(previous, {
        ...previous,
        error: null,
        phase: hasSummaryRows(previous) ? "ready" : "loading",
        requestKey: previous.requestKey ?? key,
      });
      if (next !== previous) {
        node.set(opaqueObject(next));
      }
      return generation;
    },
    view$,
  };
}

function threadSummaryViewKey(request: ThreadSummaryViewRequest): string {
  return `${request.viewId ?? "default"}\u0000${request.connectionId ?? "*"}`;
}

function threadSummaryViewRequestKey(request: ThreadSummaryViewRequest): string {
  return [
    request.viewId ?? "default",
    request.connectionId ?? "*",
    request.projectCwd ?? "",
    request.recentLimit,
    request.archivedLimit,
    request.selectedConnectionId ?? "",
    request.selectedThreadId ?? "",
    request.subagentConnectionId ?? "",
    request.subagentLimit,
  ].join("\u0000");
}

function emptyThreadSummaryView(): ThreadSummaryViewSnapshot {
  return {
    archived: [],
    error: null,
    phase: "idle",
    pinned: [],
    recent: [],
    requestKey: null,
    revision: 0,
    selected: [],
    subagents: [],
  };
}

function summaryRows(snapshot: ThreadSummaryViewSnapshot): StoredThreadSummary[] {
  const rows = new Map<string, StoredThreadSummary>();
  for (const row of [
    ...snapshot.pinned,
    ...snapshot.recent,
    ...snapshot.archived,
    ...snapshot.selected,
    ...snapshot.subagents,
  ]) {
    rows.set(threadSummaryKey(row.connectionId, row.remoteThreadId), row);
  }
  return [...rows.values()];
}

function hasSummaryRows(snapshot: ThreadSummaryViewSnapshot): boolean {
  return (
    snapshot.pinned.length +
      snapshot.recent.length +
      snapshot.archived.length +
      snapshot.selected.length +
      snapshot.subagents.length >
    0
  );
}

function reconcileSummaryContent(
  previous: ThreadSummaryViewSnapshot,
  next: LoadedThreadSummaryView,
): LoadedThreadSummaryView {
  return {
    archived: replaceEqualDeep(previous.archived, next.archived),
    pinned: replaceEqualDeep(previous.pinned, next.pinned),
    recent: replaceEqualDeep(previous.recent, next.recent),
    selected: replaceEqualDeep(previous.selected, next.selected),
    subagents: replaceEqualDeep(previous.subagents, next.subagents),
  };
}

function summaryContentChanged(
  previous: ThreadSummaryViewSnapshot,
  next: LoadedThreadSummaryView,
): boolean {
  return (
    previous.pinned !== next.pinned ||
    previous.recent !== next.recent ||
    previous.archived !== next.archived ||
    previous.selected !== next.selected ||
    previous.subagents !== next.subagents
  );
}

function summaryViewSatisfiesSelection(
  snapshot: ThreadSummaryViewSnapshot,
  request: ThreadSummaryViewRequest,
): boolean {
  if (request.selectedConnectionId === null || request.selectedThreadId === null) {
    return true;
  }
  return summaryRows(snapshot).some(
    (row) =>
      row.connectionId === request.selectedConnectionId &&
      row.remoteThreadId === request.selectedThreadId,
  );
}

function summaryViewSatisfiesVisiblePartition(
  previous: ThreadSummaryViewRequest | undefined,
  next: ThreadSummaryViewRequest,
): boolean {
  return !(
    (next.recentLimit > 0 && (previous?.recentLimit ?? 0) === 0) ||
    (next.archivedLimit > 0 && (previous?.archivedLimit ?? 0) === 0)
  );
}
