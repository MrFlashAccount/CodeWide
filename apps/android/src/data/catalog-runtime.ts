import type { RpcClient } from "@codewide/sync-client";
import { createCatalogLifecycle } from "./catalog-lifecycle";
import { catalogSummaryModel } from "./catalog-summary-model";
import { loadSubagentDescendants } from "./subagent-loader";
import { loadThreadCatalogPage, THREAD_CATALOG_PAGE_SIZE } from "./thread-catalog-loader";
import type { ThreadCatalogRead } from "./thread-catalog-read";
import { ThreadCatalogWindow } from "./thread-catalog-window";
import { shouldRepairThreadDetail } from "./thread-detail-refresh-policy";
import { type ThreadSummaryDatabase } from "./thread-summary-database";
import type { ThreadReadOperation } from "./thread-sync-types";
/** Current catalog publication and observed-thread authority from the JS singleton. */
export type CatalogRuntimeAuthority = {
  getSession(connectionId: string): RpcClient | undefined;
  getSummaries(): ThreadSummaryDatabase | null;
  enabledConnectionIds(): string[];
  desiredThreadId(connectionId: string): string | undefined;
  readThread: ThreadReadOperation;
};
/** Retains catalog windows, freshness, invalidation and subagent refresh ownership. */
export function createCatalogRuntime({
  getSession,
  getSummaries,
  enabledConnectionIds,
  desiredThreadId,
  readThread,
}: CatalogRuntimeAuthority) {
  const threadInvalidationArchived = new Map<string, boolean>();
  const threadCatalogRefreshInFlight = new Map<string, Promise<void>>();
  const threadCatalogWindows = new Map<string, ThreadCatalogWindow>();
  const threadCatalogRefreshedAt = new Map<string, number>();
  const subagentRefreshInFlight = new Map<string, Promise<void>>();
  const subagentRefreshedAt = new Map<string, number>();
  const refreshThreadCatalog = (connectionId: string, force = false): Promise<void> => {
    const now = Date.now();
    if (
      !force &&
      now - (threadCatalogRefreshedAt.get(connectionId) ?? 0) < THREAD_CATALOG_REPAIR_INTERVAL_MS
    ) {
      return Promise.resolve();
    }
    const pending = threadCatalogRefreshInFlight.get(connectionId);
    if (pending !== undefined) return pending;
    const operation = (async () => {
      const session = getSession(connectionId);
      const summaries = getSummaries();
      if (session === undefined || summaries === null) return;
      pruneInactiveProjectCatalogWindows(summaries);
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
        )
          refreshes.push(window.refresh());
      }
      await Promise.all(refreshes);
      threadCatalogRefreshedAt.set(connectionId, Date.now());
    })().finally(() => {
      if (threadCatalogRefreshInFlight.get(connectionId) === operation) {
        threadCatalogRefreshInFlight.delete(connectionId);
      }
    });
    threadCatalogRefreshInFlight.set(connectionId, operation);
    return operation;
  };

  const refreshSubagents = (
    connectionId: string,
    rootThreadId: string,
    force = false,
  ): Promise<void> => {
    const key = `${connectionId}\u0000${rootThreadId}`;
    const now = Date.now();
    if (!force && now - (subagentRefreshedAt.get(key) ?? 0) < THREAD_CATALOG_REPAIR_INTERVAL_MS) {
      return Promise.resolve();
    }
    const pending = subagentRefreshInFlight.get(key);
    if (pending !== undefined) return pending;
    const operation = (async () => {
      const session = getSession(connectionId);
      const summaries = getSummaries();
      if (session === undefined || summaries === null) return;
      const descendants = await loadSubagentDescendants(session, rootThreadId);
      await summaries.replaceSubagentCatalog(connectionId, rootThreadId, descendants);
      subagentRefreshedAt.set(key, Date.now());
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
      if (!key.startsWith(`${connectionId}\u0000`)) continue;
      window.close();
      threadCatalogWindows.delete(key);
    }
  }

  function pruneInactiveProjectCatalogWindows(summaries: ThreadSummaryDatabase): void {
    const demanded = new Set<string>();
    for (const request of summaries.model.activeRequests()) {
      if (request.projectCwd === undefined || request.connectionId === null) continue;
      if (request.recentLimit > 0)
        demanded.add(catalogWindowKey(request.connectionId, false, request.projectCwd));
      if (request.archivedLimit > 0)
        demanded.add(catalogWindowKey(request.connectionId, true, request.projectCwd));
    }
    for (const [key, window] of threadCatalogWindows) {
      // Only project scopes are view-owned; the two global windows repair the
      // connection catalog independently of whether the sidebar is mounted.
      if (key.indexOf("\u0000", key.indexOf("\u0000") + 1) === -1 || demanded.has(key)) continue;
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
    if (existing !== undefined) return existing;
    let read: ThreadCatalogRead | null = null;
    let countRead: { revision: number; count: number | null } | null = null;
    const window = new ThreadCatalogWindow(
      {
        async load(request) {
          read?.release();
          const session = getSession(connectionId);
          const summaries = getSummaries();
          if (session === undefined || summaries === null)
            throw new Error("Catalog connection is unavailable");
          const lease = summaries.beginCatalogRead(connectionId);
          read = lease;
          const revision = catalogSummaryModel.revision(connectionId);
          try {
            const page = await loadThreadCatalogPage(session, {
              ...request,
              ...(projectCwd === undefined ? {} : { projectCwd }),
            });
            countRead = { revision, count: page.archivedCount ?? null };
            return page;
          } catch (cause) {
            lease.release();
            if (read === lease) read = null;
            throw cause;
          }
        },
        async publish(threads, partition, prefixIds, replaceHead) {
          const summaries = getSummaries();
          const lease = read;
          if (summaries === null || lease === null) return;
          try {
            await summaries.applyCatalogPage(
              connectionId,
              threads,
              partition,
              prefixIds,
              lease,
              replaceHead,
              projectCwd,
            );
            if (countRead !== null)
              catalogSummaryModel.publish(connectionId, countRead.revision, countRead.count);
          } finally {
            lease.release();
            if (read === lease) read = null;
          }
        },
        close() {
          read?.release();
          read = null;
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
    if (!shouldRepairThreadDetail(desiredThreadId(connectionId), threadId)) return;
    void readThread(connectionId, threadId, undefined, true).catch((cause: unknown) => {
      console.warn(
        "CodeWide authoritative thread sync failed:",
        cause instanceof Error ? cause.message : "unknown error",
      );
    });
  }

  function bindSummaryDemand(summaries: ThreadSummaryDatabase): void {
    summaries.setCatalogLoader(async (request) => {
      pruneInactiveProjectCatalogWindows(summaries);
      const connectionIds =
        request.connectionId === null ? enabledConnectionIds() : [request.connectionId];
      await Promise.all(
        connectionIds.map(async (connectionId) => {
          const windows: Promise<void>[] = [];
          if (request.recentLimit > 0)
            windows.push(
              catalogWindow(connectionId, false, request.projectCwd).ensure(request.recentLimit),
            );
          if (request.archivedLimit > 0)
            windows.push(
              catalogWindow(connectionId, true, request.projectCwd).ensure(request.archivedLimit),
            );
          await Promise.all(windows);
        }),
      );
    });
  }

  const readInvalidationArchived = (key: string) => threadInvalidationArchived.get(key);
  const clearInvalidationArchived = (key: string) => {
    threadInvalidationArchived.delete(key);
  };
  const markRefreshed = (connectionId: string) => {
    threadCatalogRefreshedAt.set(connectionId, Date.now());
  };
  const registerLifecycle = createCatalogLifecycle({ enabledConnectionIds, refreshThreadCatalog });
  function invalidateConnection(connectionId: string): void {
    threadCatalogRefreshedAt.delete(connectionId);
    closeCatalogWindows(connectionId);
    for (const key of subagentRefreshedAt.keys()) {
      if (key.startsWith(`${connectionId}\u0000`)) subagentRefreshedAt.delete(key);
    }
  }
  function refreshConnectionWindows(connectionId: string): void {
    catalogSummaryModel.invalidate(connectionId);
    for (const [key, window] of threadCatalogWindows) {
      if (key.startsWith(`${connectionId}\u0000`)) void window.refresh().catch(() => undefined);
    }
  }
  return {
    refreshThreadCatalog,
    refreshSubagents,
    closeCatalogWindows,
    refreshInvalidatedThread,
    bindSummaryDemand,
    readInvalidationArchived,
    clearInvalidationArchived,
    markRefreshed,
    registerLifecycle,
    invalidateConnection,
    refreshConnectionWindows,
  };
}
const THREAD_CATALOG_REPAIR_INTERVAL_MS = 10 * 60 * 1_000;
