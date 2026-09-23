import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import type { RpcClient } from "@codewide/sync-client";
import { appLogger } from "../observability/logger";
import { reconcileActiveThreadCommands } from "./command-delivery";
import { recordTiming } from "./operational-metrics";
import { readPrivateAssetText } from "./private-transfer";
import {
  assertThreadSyncReachedHead,
  hydrateThreadSyncActiveText,
  latestSealedTurnId,
  parseThreadSyncResponse,
  ThreadSyncCatchUp,
  ThreadSyncLane,
  type ThreadSyncResponse,
} from "./thread-cursor-sync";
import type { ThreadDetailDatabase } from "./thread-detail-database";
import { ThreadHistoryReadAuthority } from "./thread-history-read-authority";
import { recordThreadHistoryTelemetry } from "./thread-history-telemetry";
import { THREAD_RESIDENT_TURN_LIMIT } from "./thread-pagination";
import { createThreadSyncForeground } from "./thread-sync-foreground";
import { createThreadSyncHistory } from "./thread-sync-history";
import { createThreadSyncItems } from "./thread-sync-items";
import type { ThreadSyncAuthority, ThreadWindow } from "./thread-sync-types";

const RESOLVED_VOID_PROMISE = Promise.resolve();
/** Retains shared source authority, read serialization and desired live observation. */
export function createThreadSyncRuntime({
  clearInvalidationArchived,
  getDetails,
  getSession,
  getSummaries,
  loadTurnControls,
  readInvalidationArchived,
  refreshSubagents,
  refreshThreadCatalog,
  rpcAfterAttach,
  transferAccess,
}: ThreadSyncAuthority) {
  const threadSyncLane = new ThreadSyncLane<ThreadWindow | null>();
  const historyReadAuthority = new ThreadHistoryReadAuthority();
  const threadObserverDesired = new Map<string, string>();
  const retainedObservers = new Map<string, { owners: number; threadId: string }>();
  function captureThreadHistoryRead(
    connectionId: string,
    session: RpcClient,
    details: ThreadDetailDatabase,
  ): () => boolean {
    const hasAuthority = historyReadAuthority.capture(connectionId);
    return () => hasAuthority() && getSession(connectionId) === session && getDetails() === details;
  }
  const observeThread = async (
    connectionId: string,
    threadId: string,
    keepAcrossReconnect = true,
  ): Promise<void> => {
    if (keepAcrossReconnect) {
      threadObserverDesired.set(connectionId, threadId);
    }
    // Observation owns live/reconnect demand only. Window activation owns
    // the single authoritative hydration, so one selection cannot launch a
    // weak read followed immediately by the same full thread sync.
    await RESOLVED_VOID_PROMISE;
  };

  const readThread = async (
    connectionId: string,
    threadId: string,
    cachedThread?: Thread | null,
    requireAuthoritative = false,
    repairShortWindow = false,
  ): Promise<ThreadWindow | null> => {
    const requestKey = `${connectionId}\u0000${threadId}`;
    return threadSyncLane.run(
      requestKey,
      async (): Promise<ThreadWindow | null> => {
        const details = getDetails();
        const summaries = getSummaries();
        if (details === null) {
          throw new Error("Thread history database is not available");
        }
        const cached = details.getThread(connectionId, threadId) ?? cachedThread ?? null;
        const session = getSession(connectionId);
        if (session === undefined) {
          await reconcileActiveThreadCommands(details, connectionId, threadId);
          if (cached !== null) {
            return {
              nextCursor: details.historyCursor(connectionId, threadId),
              thread: residentThreadWindow(cached),
            };
          }
          if (requireAuthoritative) {
            throw new Error("Authoritative thread sync requires an active connection");
          }
          return null;
        }
        const finishProjectionSnapshot = details.beginProjectionSnapshot(connectionId, threadId);
        const finishBackendRefresh = details.chat.beginBackendRefresh(connectionId, threadId);
        const isCurrent = captureThreadHistoryRead(connectionId, session, details);
        try {
          void refreshSubagents(connectionId, threadId).catch(() => {
            appLogger.warn({
              event: "subagent.refresh.failed",
              fields: { connectionId, threadId },
            });
          });
          const startedAt = performance.now();
          const liveRevision = details.liveRevision(connectionId, threadId);
          let afterTurnId =
            (await details.latestSealedTurnId(connectionId, threadId)) ??
            latestSealedTurnId(cached?.turns ?? []);
          const catchUp = new ThreadSyncCatchUp(
            cached,
            details.historyCursor(connectionId, threadId),
            details.historySourceWitness(connectionId, threadId),
          );
          let response: ThreadSyncResponse;
          let materialized;
          for (;;) {
            const rawResponse = await rpcAfterAttach<unknown>(session, "companion/thread/sync", {
              afterTurnId,
              limit: THREAD_RESIDENT_TURN_LIMIT,
              sourceWitness: catchUp.sourceWitness,
              threadId,
            });
            response = await hydrateThreadSyncActiveText(
              parseThreadSyncResponse(rawResponse),
              async (reference) => {
                const loaded = await readPrivateAssetText(
                  { id: reference.id, kind: "content" },
                  async (forceRefresh) => transferAccess(connectionId, forceRefresh),
                  { accept: reference.contentType },
                );
                if (
                  loaded.truncated ||
                  new TextEncoder().encode(loaded.text).byteLength !== reference.byteLength
                ) {
                  throw new Error("Active response content did not match its durable reference");
                }
                return loaded.text;
              },
            );
            if (!isCurrent()) {
              throw new Error("History read was superseded");
            }
            materialized = catchUp.accept(response);
            const lastTurn = response.history.turns.at(-1);
            if (!response.history.hasMore) {
              assertThreadSyncReachedHead(response, afterTurnId);
              break;
            }
            if (lastTurn === undefined || lastTurn.id === afterTurnId) {
              throw new Error("Companion thread sync did not advance its semantic cursor");
            }
            afterTurnId = lastTurn.id;
          }
          recordTiming("thread_cursor_sync_ms", performance.now() - startedAt);
          await details.synchronizeThread({
            connectionId,
            expectedLiveRevision: liveRevision,
            historyCursor: materialized.historyCursor,
            mode: catchUp.mode,
            thread: materialized.thread,
            throughCursor: response.throughCursor,
            ...(catchUp.sourceWitness === undefined
              ? {}
              : { sourceWitness: catchUp.sourceWitness }),
            isCurrent,
          });
          if (!isCurrent()) {
            throw new Error("History read was superseded");
          }
          finishProjectionSnapshot();
          let synchronizedThread = details.getThread(connectionId, threadId) ?? materialized.thread;
          const residentTurnCount = residentThreadWindow(synchronizedThread).turns.length;
          if (
            residentTurnCount < THREAD_RESIDENT_TURN_LIMIT &&
            (repairShortWindow || details.historyCursor(connectionId, threadId) !== null)
          ) {
            await loadCanonicalThreadTail(connectionId, threadId, details);
            synchronizedThread = details.getThread(connectionId, threadId) ?? synchronizedThread;
          }
          await reconcileActiveThreadCommands(details, connectionId, threadId);
          if (summaries !== null) {
            const previous = await summaries.get(connectionId, threadId);
            await summaries.mergeSnapshots(
              connectionId,
              [
                {
                  archived: previous?.archived ?? readInvalidationArchived(requestKey) ?? false,
                  thread: synchronizedThread,
                },
              ],
              response.throughCursor,
            );
          }
          clearInvalidationArchived(requestKey);
          recordThreadHistoryTelemetry(connectionId, threadId, "chat.history.synchronized", {
            tags: { historyKind: response.history.kind },
            values: { turnCount: synchronizedThread.turns.length },
          });
          void loadTurnControls(connectionId, synchronizedThread.cwd).catch(() => undefined);
          return {
            nextCursor: details.historyCursor(connectionId, threadId),
            thread: residentThreadWindow(synchronizedThread),
          };
        } finally {
          finishBackendRefresh();
          finishProjectionSnapshot();
        }
      },
      requireAuthoritative ? "afterCurrent" : "inFlight",
    );
  };

  const repairThreadProjection = async (
    connectionId: string,
    threadId: string,
  ): Promise<ThreadWindow | null> => {
    const cached = getDetails()?.getThread(connectionId, threadId);
    return readThread(connectionId, threadId, cached, true);
  };
  const { loadCanonicalThreadTail, loadNewerTurns, loadOlderTurns, loadTurnsBefore } =
    createThreadSyncHistory({
      captureThreadHistoryRead,
      getDetails,
      getSession,
      readThread,
      rpcAfterAttach,
    });
  const loadTurnItems = createThreadSyncItems({ getDetails, getSession, rpcAfterAttach });
  const desiredThreadId = (connectionId: string) => threadObserverDesired.get(connectionId);
  const forgetObservedThread = (connectionId: string) => {
    threadObserverDesired.delete(connectionId);
    retainedObservers.delete(connectionId);
  };
  const retainObservedThread = (connectionId: string, threadId: string): (() => void) => {
    const previous = retainedObservers.get(connectionId);
    const observation = previous?.threadId === threadId ? previous : { owners: 0, threadId };
    observation.owners += 1;
    retainedObservers.set(connectionId, observation);
    threadObserverDesired.set(connectionId, threadId);
    let retained = true;
    return () => {
      if (!retained) {
        return;
      }
      retained = false;
      const current = retainedObservers.get(connectionId);
      if (current !== observation) {
        return;
      }
      current.owners -= 1;
      if (current.owners > 0) {
        return;
      }
      retainedObservers.delete(connectionId);
      if (threadObserverDesired.get(connectionId) === threadId) {
        threadObserverDesired.delete(connectionId);
      }
    };
  };
  const invalidateHistoryReads = (connectionId: string) => {
    historyReadAuthority.invalidate(connectionId);
  };
  const bindForegroundRepair = createThreadSyncForeground({
    desiredThreadId,
    readThread,
    refreshThreadCatalog,
  });
  return {
    bindForegroundRepair,
    desiredThreadId,
    forgetObservedThread,
    invalidateHistoryReads,
    loadNewerTurns,
    loadOlderTurns,
    loadTurnItems,
    loadTurnsBefore,
    observeThread,
    readThread,
    repairThreadProjection,
    retainObservedThread,
  };
}
function residentThreadWindow(thread: Thread, limit = THREAD_RESIDENT_TURN_LIMIT): Thread {
  if (thread.turns.length <= limit) {
    return thread;
  }
  return { ...thread, turns: thread.turns.slice(-limit) };
}
