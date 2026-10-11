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
/** Current catalog publication and observed-thread authority from the JS singleton. */
export type CatalogRuntimeAuthority = {
  desiredThreadId: (connectionId: string) => string | undefined;
  enabledConnectionIds: () => string[];
  getSession: (connectionId: string) => RpcClient | undefined;
  getSummaries: () => ThreadSummaryDatabase | null;
  readThread: ThreadReadOperation;
};
/** Retains catalog windows, freshness, invalidation and subagent refresh ownership. */
export function createCatalogRuntime({
  desiredThreadId,
  enabledConnectionIds,
  getSession,
  getSummaries,
  readThread,
}: CatalogRuntimeAuthority) {
  const pins = createThreadPinsCatalog({ getSession, getSummaries });
  const readThreadSummary = createThreadSummaryMetadataReader(getSession);
  const threadInvalidationArchived = new Map<string, boolean>();
  const threadCatalogRefreshInFlight = new Map<string, Promise<void>>();
  const threadCatalogWindows = new Map<string, ThreadCatalogWindow>();
  const threadCatalogRefreshedAt = new Map<string, number>();
  const subagentRefreshInFlight = new Map<string, Promise<void>>();
  const subagentRefreshedAt = new Map<string, number>();
  const refreshThreadCatalog = async (connectionId: string, force = false): Promise<void> => {
    const now = Date.now();
    if (
      !force &&
      now - (threadCatalogRefreshedAt.get(connectionId) ?? 0) < THREAD_CATALOG_REPAIR_INTERVAL_MS
    ) {
      return;
    }
    const pending = threadCatalogRefreshInFlight.get(connectionId);
    if (pending !== undefined) {
      return pending;
    }
    const operation = (async () => {
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
      threadCatalogRefreshedAt.set(connectionId, Date.now());
    })().finally(() => {
      if (threadCatalogRefreshInFlight.get(connectionId) === operation) {
        threadCatalogRefreshInFlight.delete(connectionId);
      }
    });
    threadCatalogRefreshInFlight.set(connectionId, operation);
    return operation;
  };

  const refreshSubagents = async (
    connectionId: string,
    rootThreadId: string,
    force = false,
  ): Promise<void> => {
    const key = `${connectionId}\u0000${rootThreadId}`;
    const now = Date.now();
    if (!force && now - (subagentRefreshedAt.get(key) ?? 0) < THREAD_CATALOG_REPAIR_INTERVAL_MS) {
      return;
    }
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
      subagentRefreshedAt.set(key, Date.now());
    })().finally(() => {
      if (subagentRefreshInFlight.get(key) === operation) {
        subagentRefreshInFlight.delete(key);
      }
    });
    subagentRefreshInFlight.set(key, operation);
    return operation;
  };

  /** Reads the tree now and again while a just-spawned agent's transcript reaches the index. */
  const refreshSpawnedSubagents = (connectionId: string, rootThreadId: string): void => {
    for (const delayMs of SPAWNED_SUBAGENT_REFRESH_DELAYS_MS) {
      setTimeout(() => {
        void refreshSubagents(connectionId, rootThreadId, true).catch(() => {
          appLogger.warn({
            event: "subagent.spawn_refresh.failed",
            fields: { connectionId, threadId: rootThreadId },
          });
        });
      }, delayMs);
    }
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
          try {
            const page = await loadThreadCatalogPage(session, {
              ...request,
              ...(projectCwd === undefined ? {} : { projectCwd }),
            });
            await summaries.removeCatalogEntries(connectionId, page.excludedThreadIds);
            countRead = { count: page.archivedCount ?? null, revision };
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
          if (summaries === null || lease === null) {
            return;
          }
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
  const markRefreshed = (connectionId: string) => {
    threadCatalogRefreshedAt.set(connectionId, Date.now());
  };
  const registerLifecycle = createCatalogLifecycle({ enabledConnectionIds, refreshThreadCatalog });
  function invalidateConnection(connectionId: string): void {
    pins.invalidate(connectionId);
    threadCatalogRefreshedAt.delete(connectionId);
    closeCatalogWindows(connectionId);
    for (const key of subagentRefreshedAt.keys()) {
      if (key.startsWith(`${connectionId}\u0000`)) {
        subagentRefreshedAt.delete(key);
      }
    }
  }
  function refreshConnectionWindows(connectionId: string): void {
    void pins.ensure(connectionId, true).catch((error: unknown) => {
      appLogger.warnCaught({ error, event: "thread_pins.refresh.failed" });
    });
    catalogSummaryModel.invalidate(connectionId);
    const summaries = getSummaries();
    if (summaries === null) {
      return;
    }
    pruneInactiveCatalogWindows(summaries);
    for (const [key, window] of threadCatalogWindows) {
      if (key.startsWith(`${connectionId}\u0000`)) {
        void window.refresh().catch(() => undefined);
      }
    }
  }
  return {
    bindSummaryDemand,
    clearInvalidationArchived,
    closeCatalogWindows,
    invalidateConnection,
    markRefreshed,
    readInvalidationArchived,
    readThreadSummary,
    refreshConnectionWindows,
    refreshInvalidatedThread,
    refreshSpawnedSubagents,
    refreshSubagents,
    refreshThreadCatalog,
    refreshThreadPins,
    registerLifecycle,
  };
}
const THREAD_CATALOG_REPAIR_INTERVAL_MS = 10 * 60 * 1000;
/** The Companion's watcher debounces a transcript write by 250 ms before it reads the session. */
const SUBAGENT_INDEX_FIRST_RETRY_MS = 1000;
/** A large session takes a while to read. */
const SUBAGENT_INDEX_SLOW_READ_RETRY_MS = 4000;
const SUBAGENT_INDEX_LAST_RETRY_MS = 10_000;
const SPAWNED_SUBAGENT_REFRESH_DELAYS_MS = [
  0,
  SUBAGENT_INDEX_FIRST_RETRY_MS,
  SUBAGENT_INDEX_SLOW_READ_RETRY_MS,
  SUBAGENT_INDEX_LAST_RETRY_MS,
] as const;
