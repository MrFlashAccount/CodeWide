import { batch, observable, type Observable } from "@legendapp/state";

import { replaceEqualDeep } from "./replace-equal-deep";
import { observablePromise } from "./observablePromise";
import type { ThreadDetailRow } from "./thread-detail-projection";
import { threadLoadHasResidentSnapshot, type ThreadLoadStatus } from "./thread-load-status";
import { THREAD_RESIDENT_TURN_LIMIT } from "./thread-pagination";

export type ThreadChatWindowRequest = {
  anchorTurnId: string | null;
  connectionId: string;
  threadId: string;
};

export type ThreadChatWindowSnapshot = {
  /** An authoritative backend hydration is currently in flight. */
  backendRefreshing: boolean;
  detailRowIds: readonly string[];
  earliestSealedOrdinal: number | null;
  error: string | null;
  historyEpoch: number;
  latestSealedOrdinal: number | null;
  /** Range membership, order, sealing, or lifecycle changed. */
  layoutRevision: number;
  liveRowIds: readonly string[];
  requestKey: string | null;
  residentTurnLimit: number;
  /** Any content changed, including incremental streaming text. */
  revision: number;
  scope: string;
  status: ThreadLoadStatus;
  turnRowIds: readonly string[];
};

export type LoadedThreadChatWindow = Omit<
  ThreadChatWindowSnapshot,
  "status" | "backendRefreshing" | "error" | "layoutRevision" | "revision"
> & {
  rows: readonly ThreadDetailRow[];
};

export type ThreadChatModel = {
  beginBackendRefresh: (connectionId: string, threadId: string) => () => void;
  close: () => void;
  // WHY: This extracted V1 signature is shared by existing callers; changing its call shape would expand this behavior-preserving cleanup into an API migration.
  // oxlint-disable-next-line eslint/max-params
  commitRange: (
    connectionId: string,
    threadId: string,
    expected: Pick<ThreadChatWindowSnapshot, "historyEpoch" | "layoutRevision">,
    loaded: LoadedThreadChatWindow,
  ) => boolean;
  commitWindow: (
    request: ThreadChatWindowRequest,
    generation: number,
    loaded: LoadedThreadChatWindow,
  ) => boolean;
  failWindow: (request: ThreadChatWindowRequest, generation: number, cause: unknown) => void;
  publishChanges: (
    changes: readonly (
      | { type: "insert" | "update"; value: ThreadDetailRow }
      | { key: string; type: "delete" }
    )[],
  ) => void;
  readRows: (rowIds: readonly string[]) => ThreadDetailRow[];
  refreshThread: (connectionId: string, threadId: string, rows: readonly ThreadDetailRow[]) => void;
  residentRowCount: () => number;
  resource: (
    request: ThreadChatWindowRequest,
    loader: () => Promise<void>,
  ) => ThreadChatWindowResource;
  retainWindow: (connectionId: string, threadId: string) => () => void;
  row$: (rowId: string) => Observable<ThreadDetailRow | null>;
  startWindow: (request: ThreadChatWindowRequest) => number;
  window$: (connectionId: string, threadId: string) => Observable<ThreadChatWindowSnapshot>;
};

export type ThreadChatWindowResource = {
  ready$: Observable<boolean>;
  retain: (notify: () => void) => () => void;
  retentionSnapshot: () => number;
  window$: Observable<ThreadChatWindowSnapshot>;
};

type ThreadChatResourceRecord = {
  committedToken: number;
  hasReadySnapshot: boolean;
  loadingKey: string | null;
  ready$: Observable<boolean> | null;
  requestKey: string | null;
  readonly retain: ThreadChatWindowResource["retain"];
  readonly retentionSnapshot: ThreadChatWindowResource["retentionSnapshot"];
  retryAttempt: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  token: number;
};

export type ThreadChatModelOptions = {
  onEvictWindow?: (connectionId: string, threadId: string) => void;
  onResidentRowCountChange?: (rowCount: number) => void;
  onRetainWindow?: (connectionId: string, threadId: string) => () => void;
};

// Unowned transient resources stay bounded while the current route resource
// and mounted chats remain protected. SQLite owns evicted inactive windows.
const INACTIVE_WINDOW_LIMIT = 3;

export function createThreadChatModel(options: ThreadChatModelOptions = {}): ThreadChatModel {
  const rowNodes = new Map<string, Observable<ThreadDetailRow | null>>();
  const windowNodes = new Map<string, Observable<ThreadChatWindowSnapshot>>();
  const windowIdentities = new Map<string, { connectionId: string; threadId: string }>();
  const activeRequests = new Map<string, ThreadChatWindowRequest>();
  const retainCounts = new Map<string, number>();
  const generations = new Map<string, number>();
  const backendRefreshCounts = new Map<string, number>();
  const windowLayoutSignatures = new Map<string, string>();
  const changedRowIdsByScope = new Map<string, Set<string>>();
  const resources = new Map<string, ThreadChatResourceRecord>();
  let closed = false;
  let reportedResidentRowCount = -1;
  // Only this owner installs, deletes or evicts row values. Metadata updates
  // leave residency unchanged and must not scan every retained chat.
  let residentRowCount = 0;
  // The last requested resource owns its window independently of React's
  // passive effects. A responsive remount can release every component owner
  // for multiple commits without meaning that navigation left this resource.
  // Older windows remain in the bounded LRU; SQLite owns evicted windows.
  let residentResourceScope: string | null = null;

  const reportResidentRowCount = (): void => {
    if (options.onResidentRowCountChange === undefined) {
      return;
    }
    if (residentRowCount === reportedResidentRowCount) {
      return;
    }
    reportedResidentRowCount = residentRowCount;
    options.onResidentRowCountChange(residentRowCount);
  };

  const row$ = (rowId: string): Observable<ThreadDetailRow | null> => {
    let node = rowNodes.get(rowId);
    if (node === undefined) {
      node = observable<ThreadDetailRow | null>(null);
      rowNodes.set(rowId, node);
    }
    return node;
  };

  const window$ = (
    connectionId: string,
    threadId: string,
  ): Observable<ThreadChatWindowSnapshot> => {
    const scope = threadChatScope(connectionId, threadId);
    let node = windowNodes.get(scope);
    if (node === undefined) {
      node = observable<ThreadChatWindowSnapshot>(emptyWindow(scope));
      windowNodes.set(scope, node);
      windowIdentities.set(scope, { connectionId, threadId });
    }
    return node;
  };

  const evictWindow = (scope: string): void => {
    const identity = windowIdentities.get(scope);
    const resource = resources.get(scope);
    if (resource?.retryTimer !== null && resource?.retryTimer !== undefined) {
      clearTimeout(resource.retryTimer);
    }
    windowNodes.delete(scope);
    activeRequests.delete(scope);
    retainCounts.delete(scope);
    generations.delete(scope);
    windowIdentities.delete(scope);
    windowLayoutSignatures.delete(scope);
    changedRowIdsByScope.delete(scope);
    resources.delete(scope);
    if (identity !== undefined) {
      options.onEvictWindow?.(identity.connectionId, identity.threadId);
    }
  };

  const evictReleasedWindow = (scope: string): void => {
    if (closed || scope === residentResourceScope || (retainCounts.get(scope) ?? 0) > 0) {
      return;
    }
    evictWindow(scope);
    evictUnretainedWindows(residentResourceScope);
  };

  const scheduleReleasedWindowEviction = (scope: string): void => {
    const readiness = resources.get(scope)?.ready$?.peek();
    if (readiness === undefined) {
      queueMicrotask(() => {
        evictReleasedWindow(scope);
      });
      return;
    }
    // A replacement owner cannot retain before a suspended resource resolves.
    // Give React one task after resolution to commit that owner. The current
    // route resource remains authoritative through transient effect cleanup.
    void Promise.resolve(readiness)
      .catch(() => false)
      .finally(() => {
        setTimeout(() => {
          evictReleasedWindow(scope);
        }, 0);
      });
  };

  const retainWindow = (connectionId: string, threadId: string): (() => void) => {
    if (closed) {
      return () => undefined;
    }
    const scope = threadChatScope(connectionId, threadId);
    retainCounts.set(scope, (retainCounts.get(scope) ?? 0) + 1);
    let retained = true;
    return () => {
      if (!retained) {
        return;
      }
      retained = false;
      const next = (retainCounts.get(scope) ?? 1) - 1;
      if (next <= 0) {
        retainCounts.delete(scope);
      } else {
        retainCounts.set(scope, next);
      }
      // React may replace one external-store subscriber with another after the
      // destination resource resolves. Keep the current route resource alive
      // through that subscription handoff.
      if (next <= 0) {
        scheduleReleasedWindowEviction(scope);
      }
    };
  };

  const pruneUnreferencedRows = (): void => {
    const retainedRowIds = new Set<string>();
    for (const node of windowNodes.values()) {
      const snapshot = node.peek();
      for (const rowId of [
        ...snapshot.turnRowIds,
        ...snapshot.detailRowIds,
        ...snapshot.liveRowIds,
      ]) {
        retainedRowIds.add(rowId);
      }
    }
    for (const rowId of rowNodes.keys()) {
      if (!retainedRowIds.has(rowId)) {
        const row = rowNodes.get(rowId)?.peek();
        if (row !== null && row !== undefined) {
          residentRowCount -= 1;
        }
        rowNodes.delete(rowId);
      }
    }
    reportResidentRowCount();
  };

  // WHY: This V1 projection keeps one existing ordered decision tree; extracting branches would risk changing merge precedence during behavior-preserving cleanup.
  // oxlint-disable-next-line eslint/complexity
  const evictUnretainedWindows = (protectedScope: string | null): void => {
    let inactiveCount = 0;
    for (const scope of windowNodes.keys()) {
      if (
        scope !== protectedScope &&
        scope !== residentResourceScope &&
        (retainCounts.get(scope) ?? 0) === 0
      ) {
        inactiveCount += 1;
      }
    }
    // Map insertion order is navigation recency; live updates never promote a
    // background conversation ahead of one the user actually selected.
    for (const scope of windowNodes.keys()) {
      if (inactiveCount <= INACTIVE_WINDOW_LIMIT) {
        break;
      }
      if (
        scope === protectedScope ||
        scope === residentResourceScope ||
        (retainCounts.get(scope) ?? 0) > 0
      ) {
        continue;
      }
      evictWindow(scope);
      inactiveCount -= 1;
    }
    pruneUnreferencedRows();
  };

  const installRows = (rows: readonly ThreadDetailRow[]): boolean => {
    let changed = false;
    for (const row of rows) {
      const node = row$(row.id);
      const previous = node.peek();
      const next = previous === null ? row : replaceEqualDeep(previous, row);
      if (next === previous) {
        continue;
      }
      if (previous === null) {
        residentRowCount += 1;
      }
      node.set(next);
      changed = true;
    }
    reportResidentRowCount();
    return changed;
  };

  const recordChangedRow = (row: ThreadDetailRow): void => {
    const scope = threadChatScope(row.connectionId, row.remoteThreadId);
    const ids = changedRowIdsByScope.get(scope) ?? new Set<string>();
    ids.add(row.id);
    changedRowIdsByScope.set(scope, ids);
  };

  const commitWindowNow = (
    request: ThreadChatWindowRequest,
    generation: number,
    loaded: LoadedThreadChatWindow,
  ): boolean => {
    const scope = threadChatScope(request.connectionId, request.threadId);
    if (
      closed ||
      generations.get(scope) !== generation ||
      threadChatRequestKey(activeRequests.get(scope)) !== threadChatRequestKey(request)
    ) {
      return false;
    }
    batch(() => {
      const rowsChanged = installRows(loaded.rows);
      const node = window$(request.connectionId, request.threadId);
      const previous = node.peek();
      const signature = threadLayoutSignature(loaded.rows, loaded);
      const layoutChanged = windowLayoutSignatures.get(scope) !== signature;
      const { rows: _rows, ...loadedWindow } = loaded;
      const next = replaceEqualDeep<ThreadChatWindowSnapshot>(previous, {
        ...loadedWindow,
        backendRefreshing: previous.backendRefreshing,
        error: null,
        layoutRevision: previous.layoutRevision + (layoutChanged ? 1 : 0),
        revision: previous.revision + (rowsChanged ? 1 : 0),
        status: "ready",
      });
      if (next !== previous) {
        node.set(next);
      }
      windowLayoutSignatures.set(scope, signature);
    });
    // commitWindow is the atomic presentation seam. Mark the resident
    // snapshot ready here, in the same synchronous turn as the Legend
    // commit. Waiting for the loader promise's `.then` leaves a race where
    // the native list can draw, request a neighbouring range, and replace
    // ready$ with a second suspending promise even though usable content is
    // already resident.
    const resource = resources.get(scope);
    if (resource !== undefined && resource.requestKey === threadChatRequestKey(request)) {
      resource.hasReadySnapshot = true;
      resource.committedToken = resource.token;
    }
    return true;
  };

  const refreshThreadNow = (
    connectionId: string,
    threadId: string,
    rows: readonly ThreadDetailRow[],
  ): void => {
    const scope = threadChatScope(connectionId, threadId);
    const publishedChanges = changedRowIdsByScope.get(scope);
    changedRowIdsByScope.delete(scope);
    const request = activeRequests.get(scope);
    const node = windowNodes.get(scope);
    if (request === undefined || node === undefined) {
      return;
    }
    const previous = node.peek();
    const next = projectResidentRows(rows, previous, previous.residentTurnLimit);
    const signature = threadLayoutSignature(rows, {
      ...next,
      residentTurnLimit: previous.residentTurnLimit,
    });
    const layoutChanged = windowLayoutSignatures.get(scope) !== signature;
    const residentRowIds = new Set([
      ...previous.turnRowIds,
      ...previous.detailRowIds,
      ...previous.liveRowIds,
      ...next.turnRowIds,
      ...next.detailRowIds,
      ...next.liveRowIds,
    ]);
    const publishedContentChanged =
      publishedChanges !== undefined &&
      [...publishedChanges].some((rowId) => residentRowIds.has(rowId));
    batch(() => {
      const rowsChanged = installRows(rows.filter((row) => residentRowIds.has(row.id)));
      const nextSnapshot = replaceEqualDeep<ThreadChatWindowSnapshot>(previous, {
        ...previous,
        ...next,
        error: null,
        layoutRevision: previous.layoutRevision + (layoutChanged ? 1 : 0),
        revision: previous.revision + (publishedContentChanged || rowsChanged ? 1 : 0),
        status:
          previous.status === "initial-loading" || previous.status === "initial-error"
            ? "ready"
            : previous.status,
      });
      if (nextSnapshot !== previous) {
        node.set(nextSnapshot);
      }
    });
    windowLayoutSignatures.set(scope, signature);
  };

  // WHY: This extracted V1 signature is shared by existing callers; changing its call shape would expand this behavior-preserving cleanup into an API migration.
  // oxlint-disable-next-line eslint/max-params
  const beginResourceLoad = async (
    request: ThreadChatWindowRequest,
    loader: () => Promise<void>,
    initial: boolean,
    retryAttempt = 0,
  ): Promise<boolean> => {
    const scope = threadChatScope(request.connectionId, request.threadId);
    const requestKey = threadChatRequestKey(request);
    const record = resources.get(scope);
    const token = (record?.token ?? 0) + 1;
    if (record !== undefined) {
      if (record.retryTimer !== null) {
        clearTimeout(record.retryTimer);
      }
      record.retryTimer = null;
      record.requestKey = requestKey;
      record.loadingKey = requestKey;
      record.token = token;
      record.retryAttempt = retryAttempt;
    }
    return Promise.resolve()
      .then(loader)
      .then(() => {
        const current = resources.get(scope);
        if (
          closed ||
          current === undefined ||
          current !== record ||
          current.token !== token ||
          current.requestKey !== requestKey
        ) {
          return false;
        }
        current.loadingKey = null;
        // A superseded press can finish without installing its SQLite window.
        // Live rows (or a previous opening) do not prove this load completed.
        // Invalidate only its request so the next consumer retries normally.
        if (current.committedToken !== token) {
          current.requestKey = null;
          return false;
        }
        current.retryAttempt = 0;
        return true;
      })
      .catch((error: unknown) => {
        const current = resources.get(scope);
        const ownsLoad =
          !closed &&
          current !== undefined &&
          current === record &&
          current.token === token &&
          current.requestKey === requestKey;
        if (!ownsLoad) {
          return false;
        }
        current.loadingKey = null;
        if (initial) {
          throw error;
        }
        const retryDelay = Math.min(250 * 2 ** current.retryAttempt, 5000);
        current.retryTimer = setTimeout(() => {
          const latest = resources.get(scope);
          if (
            closed ||
            latest !== current ||
            latest.requestKey !== requestKey ||
            latest.loadingKey !== null
          ) {
            return;
          }
          beginResourceLoad(request, loader, false, current.retryAttempt + 1).catch(() => false);
        }, retryDelay);
        return false;
      });
  };

  return {
    beginBackendRefresh(connectionId, threadId) {
      const scope = threadChatScope(connectionId, threadId);
      if (closed) {
        return () => undefined;
      }
      backendRefreshCounts.set(scope, (backendRefreshCounts.get(scope) ?? 0) + 1);
      const node = window$(connectionId, threadId);
      const previous = node.peek();
      if (!previous.backendRefreshing) {
        node.set({ ...previous, backendRefreshing: true });
      }
      let active = true;
      return () => {
        if (!active) {
          return;
        }
        active = false;
        const remaining = (backendRefreshCounts.get(scope) ?? 1) - 1;
        if (remaining > 0) {
          backendRefreshCounts.set(scope, remaining);
          return;
        }
        backendRefreshCounts.delete(scope);
        if (closed) {
          return;
        }
        const current = node.peek();
        if (current.backendRefreshing) {
          node.set({ ...current, backendRefreshing: false });
        }
      };
    },
    close() {
      residentResourceScope = null;
      closed = true;
      for (const resource of resources.values()) {
        if (resource.retryTimer !== null) {
          clearTimeout(resource.retryTimer);
        }
      }
      activeRequests.clear();
      retainCounts.clear();
      generations.clear();
      backendRefreshCounts.clear();
      resources.clear();
      windowNodes.clear();
      windowIdentities.clear();
      windowLayoutSignatures.clear();
      changedRowIdsByScope.clear();
      rowNodes.clear();
      residentRowCount = 0;
      reportResidentRowCount();
    },
    // WHY: This extracted V1 signature is shared by existing callers; changing its call shape would expand this behavior-preserving cleanup into an API migration.
    // oxlint-disable-next-line eslint/max-params
    commitRange(connectionId, threadId, expected, loaded) {
      const scope = threadChatScope(connectionId, threadId);
      const node = windowNodes.get(scope);
      if (closed || node === undefined) {
        return false;
      }
      const before = node.peek();
      if (
        before.historyEpoch !== expected.historyEpoch ||
        before.layoutRevision !== expected.layoutRevision
      ) {
        return false;
      }
      batch(() => {
        const rowsChanged = installRows(loaded.rows);
        const previous = node.peek();
        if (
          previous.historyEpoch !== expected.historyEpoch ||
          previous.layoutRevision !== expected.layoutRevision
        ) {
          return;
        }
        const signature = threadLayoutSignature(loaded.rows, loaded);
        const layoutChanged = windowLayoutSignatures.get(scope) !== signature;
        const { rows: _rows, ...loadedWindow } = loaded;
        const next = replaceEqualDeep<ThreadChatWindowSnapshot>(previous, {
          ...loadedWindow,
          backendRefreshing: previous.backendRefreshing,
          error: null,
          layoutRevision: previous.layoutRevision + (layoutChanged ? 1 : 0),
          revision: previous.revision + (rowsChanged ? 1 : 0),
          status: "ready",
        });
        if (next !== previous) {
          node.set(next);
        }
        windowLayoutSignatures.set(scope, signature);
      });
      pruneUnreferencedRows();
      return true;
    },
    commitWindow(request, generation, loaded) {
      const scope = threadChatScope(request.connectionId, request.threadId);
      if (
        closed ||
        generations.get(scope) !== generation ||
        threadChatRequestKey(activeRequests.get(scope)) !== threadChatRequestKey(request)
      ) {
        return false;
      }
      return commitWindowNow(request, generation, loaded);
    },
    failWindow(request, generation, cause) {
      const scope = threadChatScope(request.connectionId, request.threadId);
      if (closed || generations.get(scope) !== generation) {
        return;
      }
      const node = window$(request.connectionId, request.threadId);
      const previous = node.peek();
      const next = replaceEqualDeep<ThreadChatWindowSnapshot>(previous, {
        ...previous,
        error: cause instanceof Error ? cause.message : "Could not load messages",
        status: threadLoadHasResidentSnapshot(previous.status)
          ? "background-retrying"
          : "initial-error",
      });
      if (next !== previous) {
        node.set(next);
      }
    },
    publishChanges(changes) {
      if (closed || changes.length === 0) {
        return;
      }
      batch(() => {
        for (const change of changes) {
          if (change.type === "delete") {
            const node = row$(change.key);
            const previous = node.peek();
            if (previous === null) {
              continue;
            }
            recordChangedRow(previous);
            residentRowCount -= 1;
            node.set(null);
            continue;
          }
          const node = row$(change.value.id);
          const previous = node.peek();
          const next = previous === null ? change.value : replaceEqualDeep(previous, change.value);
          if (next === previous) {
            continue;
          }
          recordChangedRow(change.value);
          if (previous === null) {
            residentRowCount += 1;
          }
          node.set(next);
        }
      });
      reportResidentRowCount();
    },
    readRows(rowIds) {
      return rowIds.flatMap((rowId) => {
        const row = row$(rowId).peek();
        return row === null ? [] : [row];
      });
    },
    refreshThread(connectionId, threadId, rows) {
      refreshThreadNow(connectionId, threadId, rows);
    },
    residentRowCount() {
      return residentRowCount;
    },
    // WHY: This V1 projection keeps one existing ordered decision tree; extracting branches would risk changing merge precedence during behavior-preserving cleanup.
    // oxlint-disable-next-line eslint/complexity
    resource(request, loader) {
      if (closed) {
        throw new Error("Thread chat model is closed");
      }
      const scope = threadChatScope(request.connectionId, request.threadId);
      if (residentResourceScope !== scope) {
        const resident = windowNodes.get(scope);
        if (resident !== undefined) {
          windowNodes.delete(scope);
          windowNodes.set(scope, resident);
        }
      }
      residentResourceScope = scope;
      const requestKey = threadChatRequestKey(request);
      let record = resources.get(scope);
      if (record === undefined) {
        const holder: ThreadChatResourceRecord = {
          committedToken: 0,
          hasReadySnapshot: false,
          loadingKey: requestKey,
          ready$: null,
          requestKey,
          retain: (_notify) => {
            const releaseObservation = options.onRetainWindow?.(
              request.connectionId,
              request.threadId,
            );
            const releaseWindow = retainWindow(request.connectionId, request.threadId);
            return () => {
              releaseObservation?.();
              releaseWindow();
            };
          },
          retentionSnapshot: () => 0,
          retryAttempt: 0,
          retryTimer: null,
          token: 0,
        };
        resources.set(scope, holder);
        holder.ready$ = observablePromise(beginResourceLoad(request, loader, true));
        record = holder;
      } else if (record.requestKey !== requestKey && record.loadingKey !== requestKey) {
        // Window changes preserve the current rows. The SQLite page is merged
        // into the active resident set atomically, so pagination never removes
        // the visible anchor or the mutable head.
        const load = beginResourceLoad(request, loader, !record.hasReadySnapshot);
        if (!record.hasReadySnapshot) {
          record.ready$ = observablePromise(load);
        } else {
          load.catch(() => false);
        }
      }
      if (record.ready$ === null) {
        throw new Error("Thread chat readiness was not initialized");
      }
      return {
        ready$: record.ready$,
        retain: record.retain,
        retentionSnapshot: record.retentionSnapshot,
        window$: window$(request.connectionId, request.threadId),
      };
    },
    retainWindow,
    row$,
    // WHY: This V1 projection keeps one existing ordered decision tree; extracting branches would risk changing merge precedence during behavior-preserving cleanup.
    // oxlint-disable-next-line eslint/complexity
    startWindow(request) {
      if (closed) {
        throw new Error("Thread chat model is closed");
      }
      const scope = threadChatScope(request.connectionId, request.threadId);
      const generation = (generations.get(scope) ?? 0) + 1;
      generations.set(scope, generation);
      activeRequests.set(scope, request);
      const node = window$(request.connectionId, request.threadId);
      // Protect the destination before applying the inactive-window budget.
      evictUnretainedWindows(scope);
      const previous = node.peek();
      const requestKey = threadChatRequestKey(request);
      const hasResidentSnapshot =
        resources.get(scope)?.hasReadySnapshot === true ||
        threadLoadHasResidentSnapshot(previous.status);
      const next = replaceEqualDeep<ThreadChatWindowSnapshot>(previous, {
        ...previous,
        backendRefreshing: (backendRefreshCounts.get(scope) ?? 0) > 0,
        error: null,
        requestKey,
        residentTurnLimit:
          previous.residentTurnLimit === 0 || Number.isNaN(previous.residentTurnLimit)
            ? THREAD_RESIDENT_TURN_LIMIT
            : previous.residentTurnLimit,
        status: hasResidentSnapshot
          ? previous.requestKey === requestKey
            ? "background-updating"
            : "loading-history"
          : "initial-loading",
      });
      if (next !== previous) {
        node.set(next);
      }
      return generation;
    },
    window$,
  };
}

export function threadChatScope(connectionId: string, threadId: string): string {
  return `${connectionId}\u0000${threadId}`;
}

export function threadChatRequestKey(request: ThreadChatWindowRequest): string;
export function threadChatRequestKey(request: undefined): null;
export function threadChatRequestKey(request: ThreadChatWindowRequest | undefined): string | null;
export function threadChatRequestKey(request: ThreadChatWindowRequest | undefined): string | null {
  if (request === undefined) {
    return null;
  }
  return [request.connectionId, request.threadId, request.anchorTurnId ?? ""].join("\u0000");
}

function emptyWindow(scope: string): ThreadChatWindowSnapshot {
  return {
    backendRefreshing: false,
    detailRowIds: [],
    earliestSealedOrdinal: null,
    error: null,
    historyEpoch: 0,
    latestSealedOrdinal: null,
    layoutRevision: 0,
    liveRowIds: [],
    requestKey: null,
    residentTurnLimit: THREAD_RESIDENT_TURN_LIMIT,
    revision: 0,
    scope,
    status: "idle",
    turnRowIds: [],
  };
}

function threadLayoutSignature(
  rows: readonly ThreadDetailRow[],
  window: Pick<
    ThreadChatWindowSnapshot,
    | "historyEpoch"
    | "latestSealedOrdinal"
    | "earliestSealedOrdinal"
    | "residentTurnLimit"
    | "turnRowIds"
    | "detailRowIds"
    | "liveRowIds"
  >,
): string {
  const residentRowIds = new Set([
    ...window.turnRowIds,
    ...window.detailRowIds,
    ...window.liveRowIds,
  ]);
  const rowSignature = rows
    .filter((row) => residentRowIds.has(row.id))
    // WHY: This V1 projection keeps one existing ordered decision tree; extracting branches would risk changing merge precedence during behavior-preserving cleanup.
    // oxlint-disable-next-line eslint/complexity
    .map((row) => {
      const lifecycle =
        row.kind === "thread"
          ? JSON.stringify(row.thread?.status ?? null)
          : row.kind === "turn"
            ? JSON.stringify(row.turn?.status ?? null)
            : row.kind === "pending"
              ? `${row.pending?.presentation ?? ""}:${row.pending?.state ?? ""}`
              : "";
      return `${row.id}\u0001${row.kind}\u0001${String(row.historyEpoch)}\u0001${String(row.ordinal)}\u0001${String(row.sealed ? 1 : 0)}\u0001${lifecycle}`;
    })
    .sort()
    .join("\u0002");
  return [
    window.historyEpoch,
    window.latestSealedOrdinal ?? "",
    window.earliestSealedOrdinal ?? "",
    window.residentTurnLimit,
    rowSignature,
  ].join("\u0003");
}

// WHY: This V1 projection keeps one existing ordered decision tree; extracting branches would risk changing merge precedence during behavior-preserving cleanup.
// oxlint-disable-next-line eslint/complexity
function projectResidentRows(
  rows: readonly ThreadDetailRow[],
  window: ThreadChatWindowSnapshot,
  turnLimit: number,
): Pick<
  ThreadChatWindowSnapshot,
  | "historyEpoch"
  | "turnRowIds"
  | "detailRowIds"
  | "liveRowIds"
  | "latestSealedOrdinal"
  | "earliestSealedOrdinal"
> {
  const currentEpoch =
    rows.find((row) => row.kind === "thread")?.historyEpoch ?? window.historyEpoch;
  const epochChanged = currentEpoch !== window.historyEpoch;
  const epochRows = rows.filter((row) => row.historyEpoch === currentEpoch);
  const allSealedTurns = epochRows
    .filter((row) => row.kind === "turn" && row.sealed)
    .sort((left, right) => {
      const ordinalOrder = right.ordinal - left.ordinal;
      return ordinalOrder !== 0 ? ordinalOrder : right.id.localeCompare(left.id);
    });
  const currentTurnIds = new Set(window.turnRowIds);
  const currentTurns = allSealedTurns.filter((row) => currentTurnIds.has(row.id));
  const residentMaximum = currentTurns.reduce<number | null>(
    (maximum, row) => (maximum === null ? row.ordinal : Math.max(maximum, row.ordinal)),
    null,
  );
  const previousLiveIds = new Set(window.liveRowIds);
  const completedResidentLiveTurn = allSealedTurns.some((row) => previousLiveIds.has(row.id));
  const rangeIncludesLatest =
    window.latestSealedOrdinal === null ||
    (residentMaximum !== null && residentMaximum >= window.latestSealedOrdinal) ||
    (residentMaximum === null && completedResidentLiveTurn);
  // A live completion advances a range only when that range already contains
  // the previous newest turn. Position still belongs exclusively to LegendList.
  const visibleTurns =
    epochChanged || (residentMaximum === null && window.latestSealedOrdinal === null)
      ? allSealedTurns.slice(0, turnLimit)
      : rangeIncludesLatest
        ? advanceResidentTail(
            allSealedTurns,
            currentTurnIds,
            currentTurns.length,
            previousLiveIds,
            residentMaximum,
            turnLimit,
          )
        : currentTurns;
  const minOrdinal =
    visibleTurns.length === 0 ? null : Math.min(...visibleTurns.map(({ ordinal }) => ordinal));
  const maxOrdinal =
    visibleTurns.length === 0 ? null : Math.max(...visibleTurns.map(({ ordinal }) => ordinal));
  return {
    detailRowIds:
      minOrdinal === null || maxOrdinal === null
        ? []
        : epochRows
            .filter(
              (row) =>
                row.sealed &&
                (row.kind === "turnMeta" || row.kind === "activity") &&
                row.ordinal >= minOrdinal &&
                row.ordinal <= maxOrdinal,
            )
            .map(({ id }) => id),
    earliestSealedOrdinal: epochChanged
      ? (allSealedTurns.at(-1)?.ordinal ?? null)
      : minimumNullable(window.earliestSealedOrdinal, allSealedTurns.at(-1)?.ordinal ?? null),
    historyEpoch: currentEpoch,
    latestSealedOrdinal: epochChanged
      ? (allSealedTurns[0]?.ordinal ?? null)
      : maximumNullable(window.latestSealedOrdinal, allSealedTurns[0]?.ordinal ?? null),
    liveRowIds: rows
      .filter((row) => !row.sealed && (row.kind === "pending" || row.historyEpoch === currentEpoch))
      .map(({ id }) => id),
    turnRowIds: visibleTurns.map(({ id }) => id),
  };
}

/** Metadata commits preserve an explicitly expanded range. Contiguous live
 * advancement may roll that same capacity forward, but cannot import a cache
 * island or grow residency indefinitely between gestures. */
// WHY: This V1 projection keeps one existing ordered decision tree; extracting branches would risk changing merge precedence during behavior-preserving cleanup.
// oxlint-disable-next-line eslint/complexity, eslint/max-params
function advanceResidentTail(
  sealedTurns: readonly ThreadDetailRow[],
  residentIds: ReadonlySet<string>,
  residentCount: number,
  previousLiveIds: ReadonlySet<string>,
  residentMaximum: number | null,
  turnLimit: number,
): ThreadDetailRow[] {
  let maximum = residentMaximum;
  for (let index = sealedTurns.length - 1; index >= 0; index -= 1) {
    const turn = sealedTurns[index];
    if (turn === undefined) {
      continue;
    }
    if (maximum === null && previousLiveIds.has(turn.id)) {
      maximum = turn.ordinal;
    } else if (maximum !== null && turn.ordinal === maximum + 1) {
      maximum = turn.ordinal;
    }
  }
  const capacity = Math.max(turnLimit, residentCount);
  const result: ThreadDetailRow[] = [];
  for (const turn of sealedTurns) {
    if (result.length === capacity) {
      break;
    }
    if (
      residentIds.has(turn.id) ||
      (maximum !== null &&
        turn.ordinal <= maximum &&
        (residentMaximum === null ? previousLiveIds.has(turn.id) : turn.ordinal > residentMaximum))
    ) {
      result.push(turn);
    }
  }
  return result;
}

function maximumNullable(left: number | null, right: number | null): number | null {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  return Math.max(left, right);
}

function minimumNullable(left: number | null, right: number | null): number | null {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  return Math.min(left, right);
}
