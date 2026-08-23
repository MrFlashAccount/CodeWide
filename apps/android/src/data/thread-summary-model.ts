import { batch, observable, type Observable } from "@legendapp/state";

import { replaceEqualDeep } from "./replace-equal-deep";
import { threadSummaryKey } from "./thread-summary-projection";
import type { StoredThreadSummary } from "./thread-summary-types";

export type ThreadSummaryViewRequest = {
  /** Independent presentation owner; list and detail ranges must not replace each other. */
  viewId?: string;
  connectionId: string | null;
  recentLimit: number;
  archivedLimit: number;
  selectedConnectionId: string | null;
  selectedThreadId: string | null;
  subagentConnectionId: string | null;
  subagentLimit: number;
};

export type ThreadSummaryViewSnapshot = {
  requestKey: string | null;
  phase: "idle" | "loading" | "ready" | "error";
  error: string | null;
  pinned: readonly StoredThreadSummary[];
  recent: readonly StoredThreadSummary[];
  archived: readonly StoredThreadSummary[];
  selected: readonly StoredThreadSummary[];
  subagents: readonly StoredThreadSummary[];
  revision: number;
};

export type LoadedThreadSummaryView = Pick<
  ThreadSummaryViewSnapshot,
  "pinned" | "recent" | "archived" | "selected" | "subagents"
>;

export type ThreadSummaryModel = {
  view$(request: ThreadSummaryViewRequest): Observable<ThreadSummaryViewSnapshot>;
  resource(request: ThreadSummaryViewRequest, loader: () => Promise<LoadedThreadSummaryView>): ThreadSummaryViewResource;
  retainView(request: Pick<ThreadSummaryViewRequest, "viewId" | "connectionId">): () => void;
  startView(request: ThreadSummaryViewRequest): number;
  commitView(request: ThreadSummaryViewRequest, generation: number, loaded: LoadedThreadSummaryView): boolean;
  failView(request: ThreadSummaryViewRequest, generation: number, cause: unknown): void;
  publish(changes: readonly ({ type: "insert" | "update"; value: StoredThreadSummary } | { type: "delete"; key: string })[]): void;
  activeRequests(): readonly ThreadSummaryViewRequest[];
  close(): void;
};

export type ThreadSummaryViewResource = {
  ready$: Observable<boolean>;
  view$: Observable<ThreadSummaryViewSnapshot>;
};

export function createThreadSummaryModel(): ThreadSummaryModel {
  const views = new Map<string, Observable<ThreadSummaryViewSnapshot>>();
  const requests = new Map<string, ThreadSummaryViewRequest>();
  const generations = new Map<string, number>();
  const retainCounts = new Map<string, number>();
  const resources = new Map<string, {
    ready$: Observable<boolean>;
    requestRevision: string;
    loadingRevision: string | null;
    generation: number;
    hasReadySnapshot: boolean;
    initialFailed: boolean;
    retryAttempt: number;
    retryTimer: ReturnType<typeof setTimeout> | null;
    pendingChanges: Array<{ type: "insert" | "update"; value: StoredThreadSummary } | { type: "delete"; key: string }>;
  }>();
  let closed = false;

  const view$ = (request: ThreadSummaryViewRequest): Observable<ThreadSummaryViewSnapshot> => {
    const key = threadSummaryViewKey(request);
    let node = views.get(key);
    if (node === undefined) {
      node = observable<ThreadSummaryViewSnapshot>(emptyThreadSummaryView());
      views.set(key, node);
    }
    return node;
  };

  const evict = (key: string): void => {
    const resource = resources.get(key);
    if (resource?.retryTimer !== null && resource?.retryTimer !== undefined) clearTimeout(resource.retryTimer);
    views.delete(key);
    resources.delete(key);
    requests.delete(key);
    generations.delete(key);
    retainCounts.delete(key);
  };

  const beginResourceLoad = (
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
      if (record.retryTimer !== null) clearTimeout(record.retryTimer);
      record.retryTimer = null;
      record.requestRevision = requestRevision;
      record.loadingRevision = requestRevision;
      record.generation = generation;
      record.initialFailed = false;
      record.retryAttempt = retryAttempt;
    }
    return Promise.resolve().then(loader).then((loaded) => {
      const current = resources.get(key);
      if (closed || current === undefined || current.generation !== generation || current.requestRevision !== requestRevision) return false;
      const projected = applySummaryChanges(loaded, current.pendingChanges, request);
      current.pendingChanges = [];
      current.loadingRevision = null;
      current.hasReadySnapshot = true;
      current.retryAttempt = 0;
      const node = view$(request);
      const previous = node.peek();
      const content = reconcileSummaryContent(previous, projected);
      const contentChanged = summaryContentChanged(previous, content);
      const next = replaceEqualDeep<ThreadSummaryViewSnapshot>(previous, {
        requestKey: requestRevision,
        phase: "ready",
        error: null,
        ...content,
        revision: previous.revision + (contentChanged ? 1 : 0),
      });
      if (next !== previous) node.set(next);
      return true;
    }).catch((cause: unknown) => {
      const current = resources.get(key);
      const ownsLoad = !closed
        && current !== undefined
        && current.generation === generation
        && current.requestRevision === requestRevision;
      if (!ownsLoad) return false;
      current.loadingRevision = null;
      current.initialFailed = initial;
      const node = view$(request);
      const previous = node.peek();
      node.set({
        ...previous,
        phase: hasSummaryRows(previous) ? "ready" : "error",
        error: cause instanceof Error ? cause.message : "Could not load chats",
      });
      if (initial) throw cause;
      const retryDelay = Math.min(250 * (2 ** current.retryAttempt), 5_000);
      current.retryTimer = setTimeout(() => {
        const latest = resources.get(key);
        if (closed || latest !== current || latest.requestRevision !== requestRevision || latest.loadingRevision !== null) return;
        void beginResourceLoad(request, loader, false, current.retryAttempt + 1);
      }, retryDelay);
      return false;
    });
  };

  return {
    view$,
    resource(request, loader) {
      if (closed) throw new Error("Thread summary model is closed");
      const key = threadSummaryViewKey(request);
      const requestRevision = threadSummaryViewRequestKey(request);
      let record = resources.get(key);
      if (record === undefined) {
        // Register the record before the Promise can settle so synchronous test
        // loaders and cached native reads still commit into the owned resource.
        const holder = {
          ready$: null as unknown as Observable<boolean>,
          requestRevision,
          loadingRevision: requestRevision,
          generation: 0,
          hasReadySnapshot: false,
          initialFailed: false,
          retryAttempt: 0,
          retryTimer: null,
          pendingChanges: [],
        };
        resources.set(key, holder);
        const ready$ = observable(beginResourceLoad(request, loader, true));
        holder.ready$ = ready$ as unknown as Observable<boolean>;
        holder.generation = generations.get(key) ?? 0;
        record = holder;
      } else if (record.initialFailed && record.loadingRevision === null) {
        record.ready$ = observable(beginResourceLoad(request, loader, true)) as unknown as Observable<boolean>;
      } else if (record.requestRevision !== requestRevision && record.loadingRevision !== requestRevision) {
        // A larger list range or a changed selected/subagent projection keeps
        // the complete resident snapshot visible. Only the atomic replacement
        // is published when the new SQLite range is ready.
        const blocksNavigation = !record.hasReadySnapshot || !summaryViewSatisfiesSelection(view$(request).peek(), request);
        const load = beginResourceLoad(request, loader, blocksNavigation);
        if (blocksNavigation) record.ready$ = observable(load) as unknown as Observable<boolean>;
        else void load;
      }
      return { ready$: record.ready$, view$: view$(request) };
    },
    retainView(request) {
      if (closed) return () => undefined;
      const key = `${request.viewId ?? "default"}\u0000${request.connectionId ?? "*"}`;
      retainCounts.set(key, (retainCounts.get(key) ?? 0) + 1);
      let retained = true;
      return () => {
        if (!retained) return;
        retained = false;
        const next = (retainCounts.get(key) ?? 1) - 1;
        if (next <= 0) evict(key);
        else retainCounts.set(key, next);
      };
    },
    startView(request) {
      if (closed) throw new Error("Thread summary model is closed");
      const key = threadSummaryViewKey(request);
      const generation = (generations.get(key) ?? 0) + 1;
      generations.set(key, generation);
      requests.set(key, request);
      const node = view$(request);
      const previous = node.peek();
      const next = replaceEqualDeep<ThreadSummaryViewSnapshot>(previous, {
        ...previous,
        requestKey: key,
        phase: hasSummaryRows(previous) ? "ready" : "loading",
        error: null,
      });
      if (next !== previous) node.set(next);
      return generation;
    },
    commitView(request, generation, loaded) {
      const key = threadSummaryViewKey(request);
      if (closed || generations.get(key) !== generation) return false;
      const node = view$(request);
      const previous = node.peek();
      const content = reconcileSummaryContent(previous, loaded);
      const contentChanged = summaryContentChanged(previous, content);
      const next = replaceEqualDeep<ThreadSummaryViewSnapshot>(previous, {
        requestKey: key,
        phase: "ready",
        error: null,
        ...content,
        revision: previous.revision + (contentChanged ? 1 : 0),
      });
      if (next !== previous) node.set(next);
      return true;
    },
    failView(request, generation, cause) {
      const key = threadSummaryViewKey(request);
      if (closed || generations.get(key) !== generation) return;
      const node = view$(request);
      const previous = node.peek();
      const next = replaceEqualDeep<ThreadSummaryViewSnapshot>(previous, {
        ...previous,
        phase: hasSummaryRows(previous) ? "ready" : "error",
        error: cause instanceof Error ? cause.message : "Could not load chats",
      });
      if (next !== previous) node.set(next);
    },
    publish(changes) {
      if (closed || changes.length === 0) return;
      batch(() => {
        for (const [key, node] of views) {
          const request = requests.get(key);
          if (request === undefined) continue;
          const resource = resources.get(key);
          if (resource !== undefined && resource.loadingRevision !== null) resource.pendingChanges.push(...changes);
          const previous = node.peek();
          const residents = new Map<string, StoredThreadSummary>();
          for (const row of summaryRows(previous)) residents.set(threadSummaryKey(row.connectionId, row.remoteThreadId), row);
          for (const change of changes) {
            if (change.type === "delete") residents.delete(change.key);
            else residents.set(threadSummaryKey(change.value.connectionId, change.value.remoteThreadId), change.value);
          }
          const projected = projectThreadSummaryView([...residents.values()], request);
          const content = reconcileSummaryContent(previous, projected);
          if (!summaryContentChanged(previous, content)) continue;
          node.set({ ...previous, ...content, revision: previous.revision + 1 });
        }
      });
    },
    activeRequests() {
      return [...requests.values()];
    },
    close() {
      closed = true;
      for (const resource of resources.values()) if (resource.retryTimer !== null) clearTimeout(resource.retryTimer);
      views.clear();
      resources.clear();
      requests.clear();
      generations.clear();
      retainCounts.clear();
    },
  };
}

export function projectThreadSummaryView(
  rows: readonly StoredThreadSummary[],
  request: ThreadSummaryViewRequest,
): LoadedThreadSummaryView {
  const inConnection = (row: StoredThreadSummary): boolean => request.connectionId === null || row.connectionId === request.connectionId;
  const root = (row: StoredThreadSummary): boolean => row.parentThreadId === null && row.deleteCommandId === null && inConnection(row);
  const pinned = rows.filter((row) => root(row) && !row.archived && row.pinned).sort(compareRecency);
  const recent = rows.filter((row) => root(row) && !row.archived && !row.pinned).sort(compareRecency).slice(0, request.recentLimit);
  const archived = rows.filter((row) => root(row) && row.archived).sort(compareArchived).slice(0, request.archivedLimit);
  const selected = request.selectedConnectionId === null || request.selectedThreadId === null
    ? []
    : rows.filter((row) => row.connectionId === request.selectedConnectionId && row.remoteThreadId === request.selectedThreadId);
  const subagents = request.subagentConnectionId === null
    ? []
    : rows
        .filter((row) => row.connectionId === request.subagentConnectionId && row.parentThreadId !== null && row.deleteCommandId === null)
        .sort(compareRecency)
        .slice(0, request.subagentLimit);
  return { pinned, recent, archived, selected, subagents };
}

export function threadSummaryViewKey(request: ThreadSummaryViewRequest): string {
  return `${request.viewId ?? "default"}\u0000${request.connectionId ?? "*"}`;
}

export function threadSummaryViewRequestKey(request: ThreadSummaryViewRequest): string {
  return [
    request.viewId ?? "default",
    request.connectionId ?? "*",
    request.recentLimit,
    request.archivedLimit,
    request.selectedConnectionId ?? "",
    request.selectedThreadId ?? "",
    request.subagentConnectionId ?? "",
    request.subagentLimit,
  ].join("\u0000");
}

function applySummaryChanges(
  loaded: LoadedThreadSummaryView,
  changes: readonly ({ type: "insert" | "update"; value: StoredThreadSummary } | { type: "delete"; key: string })[],
  request: ThreadSummaryViewRequest,
): LoadedThreadSummaryView {
  if (changes.length === 0) return loaded;
  const rows = new Map<string, StoredThreadSummary>();
  for (const row of [...loaded.pinned, ...loaded.recent, ...loaded.archived, ...loaded.selected, ...loaded.subagents]) {
    rows.set(threadSummaryKey(row.connectionId, row.remoteThreadId), row);
  }
  for (const change of changes) {
    if (change.type === "delete") rows.delete(change.key);
    else rows.set(threadSummaryKey(change.value.connectionId, change.value.remoteThreadId), change.value);
  }
  return projectThreadSummaryView([...rows.values()], request);
}

function emptyThreadSummaryView(): ThreadSummaryViewSnapshot {
  return {
    requestKey: null,
    phase: "idle",
    error: null,
    pinned: [],
    recent: [],
    archived: [],
    selected: [],
    subagents: [],
    revision: 0,
  };
}

function summaryRows(snapshot: ThreadSummaryViewSnapshot): StoredThreadSummary[] {
  const rows = new Map<string, StoredThreadSummary>();
  for (const row of [...snapshot.pinned, ...snapshot.recent, ...snapshot.archived, ...snapshot.selected, ...snapshot.subagents]) {
    rows.set(threadSummaryKey(row.connectionId, row.remoteThreadId), row);
  }
  return [...rows.values()];
}

function hasSummaryRows(snapshot: ThreadSummaryViewSnapshot): boolean {
  return snapshot.pinned.length + snapshot.recent.length + snapshot.archived.length + snapshot.selected.length + snapshot.subagents.length > 0;
}

function reconcileSummaryContent(
  previous: ThreadSummaryViewSnapshot,
  next: LoadedThreadSummaryView,
): LoadedThreadSummaryView {
  return {
    pinned: replaceEqualDeep(previous.pinned, next.pinned),
    recent: replaceEqualDeep(previous.recent, next.recent),
    archived: replaceEqualDeep(previous.archived, next.archived),
    selected: replaceEqualDeep(previous.selected, next.selected),
    subagents: replaceEqualDeep(previous.subagents, next.subagents),
  };
}

function summaryContentChanged(previous: ThreadSummaryViewSnapshot, next: LoadedThreadSummaryView): boolean {
  return previous.pinned !== next.pinned
    || previous.recent !== next.recent
    || previous.archived !== next.archived
    || previous.selected !== next.selected
    || previous.subagents !== next.subagents;
}

function summaryViewSatisfiesSelection(snapshot: ThreadSummaryViewSnapshot, request: ThreadSummaryViewRequest): boolean {
  if (request.selectedConnectionId === null || request.selectedThreadId === null) return true;
  return summaryRows(snapshot).some((row) =>
    row.connectionId === request.selectedConnectionId && row.remoteThreadId === request.selectedThreadId,
  );
}

function compareRecency(left: StoredThreadSummary, right: StoredThreadSummary): number {
  return (right.recencyAt ?? right.updatedAt) - (left.recencyAt ?? left.updatedAt)
    || threadSummaryKey(left.connectionId, left.remoteThreadId).localeCompare(threadSummaryKey(right.connectionId, right.remoteThreadId));
}

function compareArchived(left: StoredThreadSummary, right: StoredThreadSummary): number {
  return Number(right.pinned) - Number(left.pinned) || compareRecency(left, right);
}
