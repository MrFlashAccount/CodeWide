import { batch, observable, type Observable } from "@legendapp/state";

import { replaceEqualDeep } from "./replace-equal-deep";
import type { ThreadDetailRow } from "./thread-detail-projection";
import { threadLoadHasResidentSnapshot, type ThreadLoadStatus } from "./thread-load-status";
import { THREAD_RESIDENT_TURN_LIMIT } from "./thread-pagination";

export type ThreadChatWindowRequest = {
  connectionId: string;
  threadId: string;
  anchorTurnId: string | null;
};

export type ThreadChatWindowSnapshot = {
  scope: string;
  requestKey: string | null;
  status: ThreadLoadStatus;
  error: string | null;
  historyEpoch: number;
  latestSealedOrdinal: number | null;
  earliestSealedOrdinal: number | null;
  residentTurnLimit: number;
  turnRowIds: readonly string[];
  detailRowIds: readonly string[];
  liveRowIds: readonly string[];
  /** Range membership, order, sealing, or lifecycle changed. */
  layoutRevision: number;
  /** Any content changed, including incremental streaming text. */
  revision: number;
};

export type LoadedThreadChatWindow = Omit<ThreadChatWindowSnapshot, "status" | "error" | "layoutRevision" | "revision"> & {
  rows: readonly ThreadDetailRow[];
};

export type ThreadChatModel = {
  window$(connectionId: string, threadId: string): Observable<ThreadChatWindowSnapshot>;
  resource(request: ThreadChatWindowRequest, loader: () => Promise<void>): ThreadChatWindowResource;
  retainWindow(connectionId: string, threadId: string): () => void;
  row$(rowId: string): Observable<ThreadDetailRow | null>;
  readRows(rowIds: readonly string[]): ThreadDetailRow[];
  startWindow(request: ThreadChatWindowRequest): number;
  commitWindow(request: ThreadChatWindowRequest, generation: number, loaded: LoadedThreadChatWindow): boolean;
  commitRange(
    connectionId: string,
    threadId: string,
    expected: Pick<ThreadChatWindowSnapshot, "historyEpoch" | "layoutRevision">,
    loaded: LoadedThreadChatWindow,
  ): boolean;
  failWindow(request: ThreadChatWindowRequest, generation: number, cause: unknown): void;
  publishChanges(changes: readonly ({ type: "insert" | "update"; value: ThreadDetailRow } | { type: "delete"; key: string })[]): void;
  refreshThread(connectionId: string, threadId: string, rows: readonly ThreadDetailRow[]): void;
  residentRowCount(): number;
  close(): void;
};

export type ThreadChatWindowResource = {
  ready$: Observable<boolean>;
  window$: Observable<ThreadChatWindowSnapshot>;
};

export type ThreadChatModelOptions = {
  onEvictWindow?(connectionId: string, threadId: string): void;
  onResidentRowCountChange?(rowCount: number): void;
};

export function createThreadChatModel(options: ThreadChatModelOptions = {}): ThreadChatModel {
  const rowNodes = new Map<string, Observable<ThreadDetailRow | null>>();
  const windowNodes = new Map<string, Observable<ThreadChatWindowSnapshot>>();
  const windowIdentities = new Map<string, { connectionId: string; threadId: string }>();
  const activeRequests = new Map<string, ThreadChatWindowRequest>();
  const retainCounts = new Map<string, number>();
  const generations = new Map<string, number>();
  const windowLayoutSignatures = new Map<string, string>();
  const changedRowIdsByScope = new Map<string, Set<string>>();
  const resources = new Map<string, {
    ready$: Observable<boolean>;
    requestKey: string;
    loadingKey: string | null;
    token: number;
    hasReadySnapshot: boolean;
    initialFailed: boolean;
    retryAttempt: number;
    retryTimer: ReturnType<typeof setTimeout> | null;
  }>();
  let closed = false;
  let reportedResidentRowCount = -1;

  const reportResidentRowCount = (): void => {
    if (options.onResidentRowCountChange === undefined) return;
    let count = 0;
    for (const node of rowNodes.values()) if (node.peek() !== null) count += 1;
    if (count === reportedResidentRowCount) return;
    reportedResidentRowCount = count;
    options.onResidentRowCountChange(count);
  };

  const row$ = (rowId: string): Observable<ThreadDetailRow | null> => {
    let node = rowNodes.get(rowId);
    if (node === undefined) {
      node = observable<ThreadDetailRow | null>(null);
      rowNodes.set(rowId, node);
    }
    return node;
  };

  const window$ = (connectionId: string, threadId: string): Observable<ThreadChatWindowSnapshot> => {
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
    if (resource?.retryTimer !== null && resource?.retryTimer !== undefined) clearTimeout(resource.retryTimer);
    windowNodes.delete(scope);
    activeRequests.delete(scope);
    retainCounts.delete(scope);
    generations.delete(scope);
    windowIdentities.delete(scope);
    windowLayoutSignatures.delete(scope);
    changedRowIdsByScope.delete(scope);
    resources.delete(scope);
    if (identity !== undefined) options.onEvictWindow?.(identity.connectionId, identity.threadId);
  };

  const pruneUnreferencedRows = (): void => {
    const retainedRowIds = new Set<string>();
    for (const node of windowNodes.values()) {
      const snapshot = node.peek();
      for (const rowId of [...snapshot.turnRowIds, ...snapshot.detailRowIds, ...snapshot.liveRowIds]) retainedRowIds.add(rowId);
    }
    for (const rowId of rowNodes.keys()) {
      if (!retainedRowIds.has(rowId)) rowNodes.delete(rowId);
    }
    reportResidentRowCount();
  };

  const evictUnretainedWindows = (protectedScope: string | null): void => {
    for (const scope of [...windowNodes.keys()]) {
      if (scope === protectedScope || (retainCounts.get(scope) ?? 0) > 0) continue;
      evictWindow(scope);
    }
    pruneUnreferencedRows();
  };

  const installRows = (rows: readonly ThreadDetailRow[]): boolean => {
    let changed = false;
    for (const row of rows) {
      const node = row$(row.id);
      const previous = node.peek();
      const next = previous === null ? row : replaceEqualDeep(previous, row);
      if (next === previous) continue;
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

  const beginResourceLoad = (
    request: ThreadChatWindowRequest,
    loader: () => Promise<void>,
    initial: boolean,
    retryAttempt = 0,
  ): Promise<boolean> => {
    const scope = threadChatScope(request.connectionId, request.threadId);
    const requestKey = threadChatRequestKey(request) as string;
    const record = resources.get(scope);
    const token = (record?.token ?? 0) + 1;
    if (record !== undefined) {
      if (record.retryTimer !== null) clearTimeout(record.retryTimer);
      record.retryTimer = null;
      record.requestKey = requestKey;
      record.loadingKey = requestKey;
      record.token = token;
      record.initialFailed = false;
      record.retryAttempt = retryAttempt;
    }
    return Promise.resolve().then(loader).then(() => {
      const current = resources.get(scope);
      if (closed || current === undefined || current.token !== token || current.requestKey !== requestKey) return false;
      current.loadingKey = null;
      current.hasReadySnapshot = true;
      current.retryAttempt = 0;
      return true;
    }).catch((cause: unknown) => {
      const current = resources.get(scope);
      const ownsLoad = !closed
        && current !== undefined
        && current.token === token
        && current.requestKey === requestKey;
      if (!ownsLoad) return false;
      current.loadingKey = null;
      current.initialFailed = initial;
      if (initial) throw cause;
      const retryDelay = Math.min(250 * (2 ** current.retryAttempt), 5_000);
      current.retryTimer = setTimeout(() => {
        const latest = resources.get(scope);
        if (closed || latest !== current || latest.requestKey !== requestKey || latest.loadingKey !== null) return;
        void beginResourceLoad(request, loader, false, current.retryAttempt + 1);
      }, retryDelay);
      return false;
    });
  };

  return {
    window$,
    resource(request, loader) {
      if (closed) throw new Error("Thread chat model is closed");
      const scope = threadChatScope(request.connectionId, request.threadId);
      const requestKey = threadChatRequestKey(request) as string;
      let record = resources.get(scope);
      if (record === undefined) {
        const holder = {
          ready$: null as unknown as Observable<boolean>,
          requestKey,
          loadingKey: requestKey,
          token: 0,
          hasReadySnapshot: false,
          initialFailed: false,
          retryAttempt: 0,
          retryTimer: null,
        };
        resources.set(scope, holder);
        holder.ready$ = observable(beginResourceLoad(request, loader, true)) as unknown as Observable<boolean>;
        record = holder;
      } else if (record.initialFailed && record.loadingKey === null) {
        record.ready$ = observable(beginResourceLoad(request, loader, true)) as unknown as Observable<boolean>;
      } else if (record.requestKey !== requestKey && record.loadingKey !== requestKey) {
        // Window changes preserve the current rows. The SQLite page is merged
        // into the active resident set atomically, so pagination never removes
        // the visible anchor or the mutable head.
        const load = beginResourceLoad(request, loader, !record.hasReadySnapshot);
        if (!record.hasReadySnapshot) record.ready$ = observable(load) as unknown as Observable<boolean>;
        else void load;
      }
      return { ready$: record.ready$, window$: window$(request.connectionId, request.threadId) };
    },
    retainWindow(connectionId, threadId) {
      if (closed) return () => undefined;
      const scope = threadChatScope(connectionId, threadId);
      retainCounts.set(scope, (retainCounts.get(scope) ?? 0) + 1);
      let retained = true;
      return () => {
        if (!retained) return;
        retained = false;
        const next = (retainCounts.get(scope) ?? 1) - 1;
        if (next <= 0) retainCounts.delete(scope);
        else retainCounts.set(scope, next);
        // Evict only the scope whose final owner disappeared. During a React
        // navigation commit the next scope may already have been observed in
        // render but not retained by its passive effect yet.
        if (next <= 0) {
          evictWindow(scope);
          pruneUnreferencedRows();
        }
      };
    },
    row$,
    readRows(rowIds) {
      return rowIds.flatMap((rowId) => {
        const row = row$(rowId).peek();
        return row === null ? [] : [row];
      });
    },
    startWindow(request) {
      if (closed) throw new Error("Thread chat model is closed");
      const scope = threadChatScope(request.connectionId, request.threadId);
      const generation = (generations.get(scope) ?? 0) + 1;
      generations.set(scope, generation);
      activeRequests.set(scope, request);
      const node = window$(request.connectionId, request.threadId);
      // SQLite owns every inactive conversation. Keep only windows with a
      // mounted consumer; protect this scope while its load starts.
      evictUnretainedWindows(scope);
      const previous = node.peek();
      const requestKey = threadChatRequestKey(request);
      const hasResidentSnapshot = resources.get(scope)?.hasReadySnapshot === true
        || threadLoadHasResidentSnapshot(previous.status);
      const next = replaceEqualDeep<ThreadChatWindowSnapshot>(previous, {
        ...previous,
        requestKey,
        status: hasResidentSnapshot
          ? previous.requestKey === requestKey ? "background-updating" : "loading-history"
          : "initial-loading",
        error: null,
        residentTurnLimit: previous.residentTurnLimit || THREAD_RESIDENT_TURN_LIMIT,
      });
      if (next !== previous) node.set(next);
      return generation;
    },
    commitWindow(request, generation, loaded) {
      const scope = threadChatScope(request.connectionId, request.threadId);
      if (closed || generations.get(scope) !== generation || threadChatRequestKey(activeRequests.get(scope)) !== threadChatRequestKey(request)) return false;
      batch(() => {
        const rowsChanged = installRows(loaded.rows);
        const node = window$(request.connectionId, request.threadId);
        const previous = node.peek();
        const signature = threadLayoutSignature(loaded.rows, loaded);
        const layoutChanged = windowLayoutSignatures.get(scope) !== signature;
        const { rows: _rows, ...loadedWindow } = loaded;
        const next = replaceEqualDeep<ThreadChatWindowSnapshot>(previous, {
          ...loadedWindow,
          status: "ready",
          error: null,
          layoutRevision: previous.layoutRevision + (layoutChanged ? 1 : 0),
          revision: previous.revision + (rowsChanged ? 1 : 0),
        });
        if (next !== previous) node.set(next);
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
        resource.initialFailed = false;
      }
      return true;
    },
    commitRange(connectionId, threadId, expected, loaded) {
      const scope = threadChatScope(connectionId, threadId);
      const node = windowNodes.get(scope);
      if (closed || node === undefined) return false;
      const before = node.peek();
      if (before.historyEpoch !== expected.historyEpoch
        || before.layoutRevision !== expected.layoutRevision) return false;
      batch(() => {
        const rowsChanged = installRows(loaded.rows);
        const previous = node.peek();
        if (previous.historyEpoch !== expected.historyEpoch
          || previous.layoutRevision !== expected.layoutRevision) return;
        const signature = threadLayoutSignature(loaded.rows, loaded);
        const layoutChanged = windowLayoutSignatures.get(scope) !== signature;
        const { rows: _rows, ...loadedWindow } = loaded;
        const next = replaceEqualDeep<ThreadChatWindowSnapshot>(previous, {
          ...loadedWindow,
          status: "ready",
          error: null,
          layoutRevision: previous.layoutRevision + (layoutChanged ? 1 : 0),
          revision: previous.revision + (rowsChanged ? 1 : 0),
        });
        if (next !== previous) node.set(next);
        windowLayoutSignatures.set(scope, signature);
      });
      pruneUnreferencedRows();
      return true;
    },
    failWindow(request, generation, cause) {
      const scope = threadChatScope(request.connectionId, request.threadId);
      if (closed || generations.get(scope) !== generation) return;
      const node = window$(request.connectionId, request.threadId);
      const previous = node.peek();
      const next = replaceEqualDeep<ThreadChatWindowSnapshot>(previous, {
        ...previous,
        status: threadLoadHasResidentSnapshot(previous.status) ? "background-retrying" : "initial-error",
        error: cause instanceof Error ? cause.message : "Could not load messages",
      });
      if (next !== previous) node.set(next);
    },
    publishChanges(changes) {
      if (closed || changes.length === 0) return;
      batch(() => {
        for (const change of changes) {
          if (change.type === "delete") {
            const node = row$(change.key);
            const previous = node.peek();
            if (previous === null) continue;
            recordChangedRow(previous);
            node.set(null);
            continue;
          }
          const node = row$(change.value.id);
          const previous = node.peek();
          const next = previous === null ? change.value : replaceEqualDeep(previous, change.value);
          if (next === previous) continue;
          recordChangedRow(change.value);
          node.set(next);
        }
      });
      reportResidentRowCount();
    },
    refreshThread(connectionId, threadId, rows) {
      const scope = threadChatScope(connectionId, threadId);
      const publishedChanges = changedRowIdsByScope.get(scope);
      changedRowIdsByScope.delete(scope);
      const request = activeRequests.get(scope);
      const node = windowNodes.get(scope);
      if (request === undefined || node === undefined) return;
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
      const publishedContentChanged = publishedChanges !== undefined
        && [...publishedChanges].some((rowId) => residentRowIds.has(rowId));
      batch(() => {
        const rowsChanged = installRows(rows.filter((row) => residentRowIds.has(row.id)));
        const nextSnapshot = replaceEqualDeep<ThreadChatWindowSnapshot>(previous, {
          ...previous,
          ...next,
          status: previous.status === "initial-loading" || previous.status === "initial-error" ? "ready" : previous.status,
          error: null,
          layoutRevision: previous.layoutRevision + (layoutChanged ? 1 : 0),
          revision: previous.revision + (publishedContentChanged || rowsChanged ? 1 : 0),
        });
        if (nextSnapshot !== previous) node.set(nextSnapshot);
      });
      windowLayoutSignatures.set(scope, signature);
    },
    residentRowCount() {
      let count = 0;
      for (const node of rowNodes.values()) if (node.peek() !== null) count += 1;
      return count;
    },
    close() {
      closed = true;
      for (const resource of resources.values()) if (resource.retryTimer !== null) clearTimeout(resource.retryTimer);
      activeRequests.clear();
      retainCounts.clear();
      generations.clear();
      resources.clear();
      windowNodes.clear();
      windowIdentities.clear();
      windowLayoutSignatures.clear();
      changedRowIdsByScope.clear();
      rowNodes.clear();
      reportResidentRowCount();
    },
  };
}

export function threadChatScope(connectionId: string, threadId: string): string {
  return `${connectionId}\u0000${threadId}`;
}

export function threadChatRequestKey(request: ThreadChatWindowRequest | undefined): string | null {
  if (request === undefined) return null;
  return [
    request.connectionId,
    request.threadId,
    request.anchorTurnId ?? "",
  ].join("\u0000");
}

function emptyWindow(scope: string): ThreadChatWindowSnapshot {
  return {
    scope,
    requestKey: null,
    status: "idle",
    error: null,
    historyEpoch: 0,
    latestSealedOrdinal: null,
    earliestSealedOrdinal: null,
    residentTurnLimit: THREAD_RESIDENT_TURN_LIMIT,
    turnRowIds: [],
    detailRowIds: [],
    liveRowIds: [],
    layoutRevision: 0,
    revision: 0,
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
  const residentRowIds = new Set([...window.turnRowIds, ...window.detailRowIds, ...window.liveRowIds]);
  const rowSignature = rows
    .filter((row) => residentRowIds.has(row.id))
    .map((row) => {
      const lifecycle = row.kind === "thread"
        ? JSON.stringify(row.thread?.status ?? null)
        : row.kind === "turn"
          ? JSON.stringify(row.turn?.status ?? null)
          : row.kind === "pending"
            ? `${row.pending?.presentation ?? ""}:${row.pending?.state ?? ""}`
            : "";
      return `${row.id}\u0001${row.kind}\u0001${row.historyEpoch}\u0001${row.ordinal}\u0001${row.sealed ? 1 : 0}\u0001${lifecycle}`;
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

function projectResidentRows(
  rows: readonly ThreadDetailRow[],
  window: ThreadChatWindowSnapshot,
  turnLimit: number,
): Pick<ThreadChatWindowSnapshot, "historyEpoch" | "turnRowIds" | "detailRowIds" | "liveRowIds" | "latestSealedOrdinal" | "earliestSealedOrdinal"> {
  const currentEpoch = rows.find((row) => row.kind === "thread")?.historyEpoch ?? window.historyEpoch;
  const epochChanged = currentEpoch !== window.historyEpoch;
  const epochRows = rows.filter((row) => row.historyEpoch === currentEpoch);
  const allSealedTurns = epochRows
    .filter((row) => row.kind === "turn" && row.sealed)
    .sort((left, right) => right.ordinal - left.ordinal || right.id.localeCompare(left.id));
  const currentTurnIds = new Set(window.turnRowIds);
  const currentTurns = allSealedTurns.filter((row) => currentTurnIds.has(row.id));
  const residentMaximum = currentTurns.reduce<number | null>(
    (maximum, row) => maximum === null ? row.ordinal : Math.max(maximum, row.ordinal),
    null,
  );
  const previousLiveIds = new Set(window.liveRowIds);
  const completedResidentLiveTurn = allSealedTurns.some((row) => previousLiveIds.has(row.id));
  const rangeIncludesLatest = window.latestSealedOrdinal === null
    || (residentMaximum !== null && residentMaximum >= window.latestSealedOrdinal)
    || completedResidentLiveTurn;
  // A live completion advances a range only when that range already contains
  // the previous newest turn. Position still belongs exclusively to LegendList.
  const visibleTurns = epochChanged || rangeIncludesLatest
    ? allSealedTurns.slice(0, turnLimit)
    : currentTurns;
  const minOrdinal = visibleTurns.length === 0 ? null : Math.min(...visibleTurns.map(({ ordinal }) => ordinal));
  const maxOrdinal = visibleTurns.length === 0 ? null : Math.max(...visibleTurns.map(({ ordinal }) => ordinal));
  return {
    historyEpoch: currentEpoch,
    turnRowIds: visibleTurns.map(({ id }) => id),
    detailRowIds: minOrdinal === null || maxOrdinal === null ? [] : epochRows
      .filter((row) => row.sealed && (row.kind === "turnMeta" || row.kind === "activity") && row.ordinal >= minOrdinal && row.ordinal <= maxOrdinal)
      .map(({ id }) => id),
    liveRowIds: rows
      .filter((row) => !row.sealed && (row.kind === "pending" || row.historyEpoch === currentEpoch))
      .map(({ id }) => id),
    latestSealedOrdinal: epochChanged
      ? allSealedTurns[0]?.ordinal ?? null
      : maximumNullable(window.latestSealedOrdinal, allSealedTurns[0]?.ordinal ?? null),
    earliestSealedOrdinal: epochChanged
      ? allSealedTurns.at(-1)?.ordinal ?? null
      : minimumNullable(window.earliestSealedOrdinal, allSealedTurns.at(-1)?.ordinal ?? null),
  };
}

function maximumNullable(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}

function minimumNullable(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.min(left, right);
}
