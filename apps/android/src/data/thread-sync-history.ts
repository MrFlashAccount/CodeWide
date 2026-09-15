import { recordTiming } from "./operational-metrics";
import type {
  ThreadDetailDatabase,
  ThreadRemoteNewerResult,
  ThreadRemoteOlderResult,
} from "./thread-detail-database";
import { readThreadHistoryPage } from "./thread-history-page-read";
import { parseThreadHistorySummaryPage } from "./thread-history-summary-page";
import { THREAD_HISTORY_PAGE_SIZE, THREAD_RESIDENT_TURN_LIMIT } from "./thread-pagination";
import type {
  CaptureThreadHistoryRead,
  ThreadReadOperation,
  ThreadSyncAuthority,
  ThreadTurnPage,
} from "./thread-sync-types";
import { parseThreadTurnsAfterPage } from "./thread-turns-after-page";
import { parseThreadTurnsListPage } from "./thread-turns-list-page";

type HistoryAuthority = Pick<
  ThreadSyncAuthority,
  "getDetails" | "getSession" | "rpcAfterAttach"
> & {
  captureThreadHistoryRead: CaptureThreadHistoryRead;
  readThread: ThreadReadOperation;
};
/** Source-qualified paging and canonical tail installation use one captured authority. */
export function createThreadSyncHistory({
  getDetails,
  getSession,
  rpcAfterAttach,
  captureThreadHistoryRead,
  readThread,
}: HistoryAuthority) {
  const loadCanonicalThreadTail = async (
    connectionId: string,
    threadId: string,
    details: ThreadDetailDatabase,
  ): Promise<void> => {
    const session = getSession(connectionId);
    if (session === undefined) throw new Error("Connection is not enabled");
    const isCurrent = captureThreadHistoryRead(connectionId, session, details);
    const startedAt = performance.now();
    const page = parseThreadTurnsListPage(
      await rpcAfterAttach<unknown>(session, "thread/turns/list", {
        threadId,
        cursor: null,
        limit: THREAD_RESIDENT_TURN_LIMIT,
        sortDirection: "desc",
        itemsView: "summary",
      }),
      null,
    );
    recordTiming("history_page_rpc_ms", performance.now() - startedAt);
    if (!isCurrent()) throw new Error("History read was superseded");
    await details.mergeTailTurns(
      connectionId,
      threadId,
      [...page.turns].reverse(),
      page.nextCursor,
      isCurrent,
    );
  };

  const loadOlderTurns = async (
    connectionId: string,
    threadId: string,
    cursor: string | null,
    expectedHistoryEpoch: number,
  ): Promise<ThreadTurnPage> => {
    const session = getSession(connectionId);
    if (session === undefined) throw new Error("Connection is not enabled");
    const threadDetails = getDetails();
    if (threadDetails === null) throw new Error("Thread history database is not available");
    const isCurrent = captureThreadHistoryRead(connectionId, session, threadDetails);
    const startedAt = performance.now();
    const page = parseThreadTurnsListPage(
      await rpcAfterAttach<unknown>(session, "thread/turns/list", {
        threadId,
        cursor,
        limit: THREAD_HISTORY_PAGE_SIZE,
        sortDirection: "desc",
        // Summary is the modern fast path: user prompt + final answer. Full
        // activity is loaded for one turn only when the user expands it.
        itemsView: "summary",
      }),
      cursor,
    );
    recordTiming("history_page_rpc_ms", performance.now() - startedAt);
    const turns = [...page.turns].reverse();
    if (!isCurrent()) throw new Error("History read was superseded");
    const persisted = await threadDetails.prependTurns(
      connectionId,
      threadId,
      expectedHistoryEpoch,
      turns,
      page.nextCursor,
      isCurrent,
    );
    if (!persisted.accepted) throw new Error("Backend history page was not persisted");
    return {
      turns,
      nextCursor: page.nextCursor,
      acceptedHistory: true,
      extendedHistory: persisted.extendedMinimum,
    };
  };

  const loadNewerTurns = async (
    connectionId: string,
    threadId: string,
    afterTurnId: string,
    expectedHistoryEpoch: number,
  ): Promise<ThreadRemoteNewerResult> => {
    const session = getSession(connectionId);
    if (session === undefined) throw new Error("Connection is not enabled");
    const threadDetails = getDetails();
    if (threadDetails === null) throw new Error("Thread history database is not available");
    const isCurrent = captureThreadHistoryRead(connectionId, session, threadDetails);
    const startedAt = performance.now();
    const requestedSourceWitness = threadDetails.historySourceWitness(connectionId, threadId);
    const loaded = await readThreadHistoryPage({
      isCurrent,
      async repair() {
        await readThread(connectionId, threadId, undefined, true, true);
      },
      async read() {
        return parseThreadTurnsAfterPage(
          await rpcAfterAttach<unknown>(session, "companion/thread/history/after", {
            threadId,
            afterTurnId,
            limit: THREAD_HISTORY_PAGE_SIZE,
            sourceWitness: requestedSourceWitness,
          }),
          afterTurnId,
          THREAD_HISTORY_PAGE_SIZE,
        );
      },
    });
    if (loaded.status === "superseded") return loaded;
    const page = loaded.page;
    recordTiming("history_page_rpc_ms", performance.now() - startedAt);
    if (!isCurrent()) return { status: "superseded" };
    const persisted = await threadDetails.appendTurnsAfter(
      connectionId,
      threadId,
      expectedHistoryEpoch,
      afterTurnId,
      page.turns,
      page.sourceWitness,
      isCurrent,
      requestedSourceWitness,
    );
    if (!persisted.accepted || !isCurrent()) return { status: "superseded" };
    return {
      status: "persisted",
      lastTurnId: page.turns.at(-1)?.id ?? afterTurnId,
      hasMore: page.hasMore,
    };
  };

  const loadTurnsBefore = async (
    connectionId: string,
    threadId: string,
    beforeTurnId: string,
    expectedHistoryEpoch: number,
  ): Promise<ThreadRemoteOlderResult> => {
    const session = getSession(connectionId);
    if (session === undefined) throw new Error("Connection is not enabled");
    const threadDetails = getDetails();
    if (threadDetails === null) throw new Error("Thread history database is not available");
    const isCurrent = captureThreadHistoryRead(connectionId, session, threadDetails);
    const startedAt = performance.now();
    const requestedSourceWitness = threadDetails.historySourceWitness(connectionId, threadId);
    const loaded = await readThreadHistoryPage({
      isCurrent,
      async repair() {
        await readThread(connectionId, threadId, undefined, true, true);
      },
      async read() {
        return parseThreadHistorySummaryPage(
          await rpcAfterAttach<unknown>(session, "companion/thread/history/before", {
            threadId,
            beforeTurnId,
            limit: THREAD_HISTORY_PAGE_SIZE,
            sourceWitness: requestedSourceWitness,
          }),
          beforeTurnId,
          THREAD_HISTORY_PAGE_SIZE,
        );
      },
    });
    if (loaded.status === "superseded") return loaded;
    const page = loaded.page;
    recordTiming("history_page_rpc_ms", performance.now() - startedAt);
    if (!isCurrent()) return { status: "superseded" };
    const persisted = await threadDetails.prependTurnsBefore(
      connectionId,
      threadId,
      expectedHistoryEpoch,
      beforeTurnId,
      page.turns,
      page.hasMore,
      page.sourceWitness,
      isCurrent,
      requestedSourceWitness,
    );
    if (!persisted.accepted || !isCurrent()) return { status: "superseded" };
    return {
      status: "persisted",
      oldestTurnId: page.turns[0]?.id ?? beforeTurnId,
      hasMore: page.hasMore,
    };
  };
  return { loadCanonicalThreadTail, loadOlderTurns, loadNewerTurns, loadTurnsBefore };
}
