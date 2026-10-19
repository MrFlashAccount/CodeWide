import type { RpcClient } from "@codewide/sync-client";
import { createThreadPinsCatalog } from "./threadPinsCatalog";
import { createThreadSummaryMetadataReader } from "./threadSummaryMetadata";
import { appLogger } from "../observability/logger";
import { createCatalogLifecycle } from "./catalog-lifecycle";
import { catalogSummaryModel } from "./catalog-summary-model";
import { loadSubagentDescendants } from "./subagent-loader";
import { loadThreadCatalogPage, THREAD_CATALOG_PAGE_SIZE } from "./thread-catalog-loader";
import type { ThreadCatalogRead } from "./thread-catalog-read";
import { ThreadCatalogWindow } from "./thread-catalog-window";
import { shouldRepairThreadDetail } from "./thread-detail-refresh-policy";
import type { ThreadSummaryDatabase } from "./thread-summary-database";
import type { ThreadReadOperation } from "./thread-sync-types";
import type { ListStreamGeneration, ThreadListRow } from "./threadListRow";
/** Current catalog publication and observed-thread authority from the JS singleton. */
export type CatalogRuntimeAuthority = {
  desiredThreadId: (connectionId: string) => string | undefined;
  enabledConnectionIds: () => string[];
  getSession: (connectionId: string) => RpcClient | undefined;
  getSummaries: () => ThreadSummaryDatabase | null;
  /** Generation of the connection's list stream; a page read under another one is stale. */
  listGeneration: (connectionId: string) => ListStreamGeneration | null;
  readThread: ThreadReadOperation;
  /** Sets whether Companion pushes list rows; the lifecycle owner alone decides it. */
  setListStreamVisible: (connectionId: string, visible: boolean) => Promise<void>;
};
/**
 * Retains catalog windows, page re-reads and subagent refresh ownership.
 * Between re-reads the list stream keeps rows current, so a re-read is never
 * throttled: reconnect and foreground always read every open window again.
 */
export function createCatalogRuntime({
  desiredThreadId,
  enabledConnectionIds,
  getSession,
  getSummaries,
  listGeneration,
  readThread,
  setListStreamVisible,
}: CatalogRuntimeAuthority) {
  const pins = createThreadPinsCatalog({ getSession, getSummaries });
  const readThreadSummary = createThreadSummaryMetadataReader(getSession);
  const threadInvalidationArchived = new Map<string, boolean>();
  const catalogRefreshes = new Map<string, CatalogRefresh>();
  const threadCatalogWindows = new Map<string, ThreadCatalogWindow>();
  const subagentRefreshInFlight = new Map<string, Promise<void>>();
  /** Re-reads the connection's pins and every open window from their first page. */
  const refreshWindows = async (connectionId: string): Promise<void> => {
    const session = getSession(connectionId);
    const summaries = getSummaries();
    if (session === undefined || summaries === null) {
      return;
    }
    pruneInactiveCatalogWindows(summaries);
    const active = threadCatalogWindows.get(catalogWindowKey(connectionId, false));
    const refreshes = [
      active === undefined
        ? catalogWindow(connectionId, false).ensure(THREAD_CATALOG_PAGE_SIZE)
        : active.refresh(),
    ];
    for (const [key, window] of threadCatalogWindows) {
      if (
        key.startsWith(`${connectionId}\u0000`) &&
        key !== catalogWindowKey(connectionId, false)
      ) {
        refreshes.push(window.refresh());
      }
    }
    await Promise.all([...refreshes, pins.ensure(connectionId, true)]);
  };
  /**
   * Starts a re-read, or one trailing re-read after the running one: a caller
   * that declared visibility after a run started still gets pages read after it.
   */
  const refreshThreadCatalog = async (connectionId: string): Promise<void> => {
    const state = catalogRefreshes.get(connectionId);
    if (state === undefined) {
      const refresh: CatalogRefresh = { current: refreshWindows(connectionId), trailing: null };
      catalogRefreshes.set(connectionId, refresh);
      return settleRefresh(connectionId, refresh, refresh.current);
    }
    if (state.trailing === null) {
      const trailing = state.current
        .catch(() => undefined)
        .then(async () => {
          state.trailing = null;
          state.current = trailing;
          return refreshWindows(connectionId);
        });
      state.trailing = trailing;
      return settleRefresh(connectionId, state, trailing);
    }
    return state.trailing;
  };
  async function settleRefresh(
    connectionId: string,
    state: CatalogRefresh,
    run: Promise<void>,
  ): Promise<void> {
    return run.finally(() => {
      if (state.current === run && state.trailing === null) {
        catalogRefreshes.delete(connectionId);
      }
    });
  }

  /**
   * Reads one root's descendant index and replaces its subagent catalog. Callers are the
   * Companion's subagent invalidation, spawning calls, an older Companion's thread sync and the
   * agents view; concurrent requests for the same root share one read.
   */
  const refreshSubagents = async (connectionId: string, rootThreadId: string): Promise<void> => {
    const key = `${connectionId}\u0000${rootThreadId}`;
    const pending = subagentRefreshInFlight.get(key);
    if (pending !== undefined) {
      return pending;
    }
    const operation = (async () => {
      const session = getSession(connectionId);
      const summaries = getSummaries();
      if (session === undefined || summaries === null) {
        return;
      }
      const descendants = await loadSubagentDescendants(session, rootThreadId);
      await summaries.replaceSubagentCatalog(connectionId, rootThreadId, descendants);
    })().finally(() => {
      if (subagentRefreshInFlight.get(key) === operation) {
        subagentRefreshInFlight.delete(key);
      }
    });
    subagentRefreshInFlight.set(key, operation);
    return operation;
  };

  function catalogWindowKey(connectionId: string, archived: boolean, projectCwd?: string): string {
    return `${connectionId}\u0000${archived ? "archived" : "active"}${projectCwd === undefined ? "" : `\u0000${projectCwd}`}`;
  }

  function closeCatalogWindows(connectionId: string): void {
    catalogSummaryModel.invalidate(connectionId);
    for (const [key, window] of threadCatalogWindows) {
      if (!key.startsWith(`${connectionId}\u0000`)) {
        continue;
      }
      window.close();
      threadCatalogWindows.delete(key);
    }
  }

  function pruneInactiveCatalogWindows(summaries: ThreadSummaryDatabase): void {
    const demanded = new Set<string>();
    for (const request of summaries.model.activeRequests()) {
      const connectionIds =
        request.connectionId === null ? enabledConnectionIds() : [request.connectionId];
      for (const connectionId of connectionIds) {
        if (request.projectCwd !== undefined && request.recentLimit > 0) {
          demanded.add(catalogWindowKey(connectionId, false, request.projectCwd));
        }
        if (request.archivedLimit > 0) {
          demanded.add(catalogWindowKey(connectionId, true, request.projectCwd));
        }
      }
    }
    for (const [key, window] of threadCatalogWindows) {
      const separator = key.indexOf("\u0000");
      const connectionId = key.slice(0, separator);
      // The global active catalog repairs the primary list independently. Archive
      // and project windows exist only while a matching view requests them.
      if (key === catalogWindowKey(connectionId, false) || demanded.has(key)) {
        continue;
      }
      window.close();
      threadCatalogWindows.delete(key);
    }
  }

  function catalogWindow(
    connectionId: string,
    archived: boolean,
    projectCwd?: string,
  ): ThreadCatalogWindow {
    const key = catalogWindowKey(connectionId, archived, projectCwd);
    const existing = threadCatalogWindows.get(key);
    if (existing !== undefined) {
      return existing;
    }
    let read: ThreadCatalogRead | null = null;
    let countRead: { count: number | null; revision: number } | null = null;
    let loaded: {
      readonly generation: ListStreamGeneration | null;
      readonly rows: readonly ThreadListRow[];
      readonly threads: readonly unknown[];
    } | null = null;
    const window = new ThreadCatalogWindow(
      {
        close() {
          read?.release();
          read = null;
        },
        async load(request) {
          read?.release();
          const session = getSession(connectionId);
          const summaries = getSummaries();
          if (session === undefined || summaries === null) {
            throw new Error("Catalog connection is unavailable");
          }
          const lease = summaries.beginCatalogRead(connectionId);
          read = lease;
          const revision = catalogSummaryModel.revision(connectionId);
          // Captured before the read: a socket replaced meanwhile makes the page stale.
          const generation = listGeneration(connectionId);
          try {
            const page = await loadThreadCatalogPage(session, {
              ...request,
              ...(projectCwd === undefined ? {} : { projectCwd }),
            });
            await summaries.removeCatalogEntries(connectionId, page.excludedThreadIds);
            countRead = { count: page.archivedCount ?? null, revision };
            loaded = { generation, rows: page.rows, threads: page.threads };
            return page;
          } catch (error) {
            lease.release();
            if (read === lease) {
              read = null;
            }
            throw error;
          }
        },
        async publish(threads, partition, prefixIds, replaceHead) {
          const summaries = getSummaries();
          const lease = read;
          const page = loaded;
          loaded = null;
          if (summaries === null || lease === null) {
            return;
          }
          if (page?.threads !== threads) {
            lease.release();
            throw new Error("Catalog page publication does not match its read");
          }
          try {
            await summaries.applyCatalogPage(
              connectionId,
              { generation: page.generation, rows: page.rows },
              partition,
              prefixIds,
              lease,
              replaceHead,
              projectCwd,
            );
            if (countRead !== null) {
              catalogSummaryModel.publish(connectionId, countRead.revision, countRead.count);
            }
          } finally {
            lease.release();
            if (read === lease) {
              read = null;
            }
          }
        },
      },
      archived,
    );
    threadCatalogWindows.set(key, window);
    return window;
  }

  function refreshInvalidatedThread(
    connectionId: string,
    threadId: string,
    archived: boolean,
  ): void {
    const key = `${connectionId}\u0000${threadId}`;
    threadInvalidationArchived.set(key, archived);
    if (!shouldRepairThreadDetail(desiredThreadId(connectionId), threadId)) {
      return;
    }
    void readThread(connectionId, threadId, undefined, true).catch(() => {
      appLogger.warn({
        event: "thread.authoritative_sync.failed",
        fields: { connectionId, threadId },
      });
    });
  }

  function bindSummaryDemand(summaries: ThreadSummaryDatabase): void {
    summaries.setCatalogLoader(async (request) => {
      pruneInactiveCatalogWindows(summaries);
      const connectionIds =
        request.connectionId === null ? enabledConnectionIds() : [request.connectionId];
      const continuations = await Promise.all(
        connectionIds.map(async (connectionId) => {
          await pins.ensure(connectionId);
          const windows: Promise<boolean>[] = [];
          if (request.recentLimit > 0) {
            windows.push(
              catalogWindow(connectionId, false, request.projectCwd).ensure(request.recentLimit),
            );
          }
          if (request.archivedLimit > 0) {
            windows.push(
              catalogWindow(connectionId, true, request.projectCwd).ensure(request.archivedLimit),
            );
          }
          return (await Promise.all(windows)).some(Boolean);
        }),
      );
      return continuations.some(Boolean);
    });
  }

  const readInvalidationArchived = (key: string) => threadInvalidationArchived.get(key);
  const clearInvalidationArchived = (key: string) => {
    threadInvalidationArchived.delete(key);
  };
  const refreshThreadPins = async (connectionId: string): Promise<void> =>
    pins.ensure(connectionId, true);
  const lifecycle = createCatalogLifecycle({
    enabledConnectionIds,
    refreshThreadCatalog,
    setListStreamVisible,
  });
  function invalidateConnection(connectionId: string): void {
    pins.invalidate(connectionId);
    closeCatalogWindows(connectionId);
  }
  return {
    bindSummaryDemand,
    clearInvalidationArchived,
    closeCatalogWindows,
    invalidateConnection,
    readInvalidationArchived,
    readThreadSummary,
    refreshInvalidatedThread,
    refreshSubagents,
    refreshThreadCatalog,
    refreshThreadPins,
    refreshVisibleCatalog: lifecycle.refreshVisibleCatalog,
    registerLifecycle: lifecycle.register,
  };
}
/** The running re-read of one connection and at most one trailing re-read after it. */
type CatalogRefresh = { current: Promise<void>; trailing: Promise<void> | null };
