import type { ThreadChatWindowRequest } from "../../data/thread-chat-model";
import { projectThreadChatWindow } from "../../data/thread-chat-projection";
import { threadLoadBlocksPresentation } from "../../data/thread-load-status";
import type { ThreadHistoryState } from "../../data/thread-pagination";
import type { StoredThreadSummary } from "../../data/thread-summary-types";
import type { useThreadChatWindow } from "../../data/use-thread-chat-window";
import type { useThreadHistoryCursor } from "../../data/use-thread-history";
import { useThreadHistoryController } from "../../data/use-thread-history-controller";
import type { threadHistoryResourceKey } from "../../data/workspace-resource-keys";
import type { MessageListState } from "../../ui/MessageListBoundary";
import type {
  ConversationDestinationBaseProps,
  ConversationDetailResources,
} from "./conversationCapabilities";

/** Binds existing scoped owners in their original hook order; owns no replacement state. */
export function useMainConversationHistory({
  chatDatabase,
  chatSnapshot,
  chatWindow,
  chatWindowRequest,
  connectionId,
  conversation,
  historyModel,
  historyResourceId,
  historyResourceRaw,
  resources,
  storedThread,
  threadId,
  threadOpenGeneration,
}: {
  chatDatabase: NonNullable<ConversationDetailResources["threadDetails"]>;
  chatSnapshot: NonNullable<ReturnType<typeof useThreadChatWindow>>["snapshot"];
  chatWindow: NonNullable<ReturnType<typeof useThreadChatWindow>>;
  chatWindowRequest: ThreadChatWindowRequest;
  connectionId: string;
  conversation: Omit<ConversationDestinationBaseProps, "navigationKey">;
  historyModel: ConversationDetailResources["threadHistoryModel"];
  historyResourceId: ReturnType<typeof threadHistoryResourceKey>;
  historyResourceRaw: ReturnType<typeof useThreadHistoryCursor>;
  resources: ConversationDetailResources;
  storedThread: StoredThreadSummary | null;
  threadId: string;
  threadOpenGeneration: number;
}) {
  const latestResidentOrdinal = chatWindow.turnRows.reduce<number | null>(
    (maximum, row) =>
      row.kind !== "turn" || !row.sealed
        ? maximum
        : maximum === null
          ? row.ordinal
          : Math.max(maximum, row.ordinal),
    null,
  );
  const isLatestRange =
    chatSnapshot.latestSealedOrdinal === null ||
    (latestResidentOrdinal !== null && latestResidentOrdinal >= chatSnapshot.latestSealedOrdinal);
  const earliestResidentOrdinal = chatWindow.turnRows.reduce<number | null>(
    (minimum, row) =>
      row.kind !== "turn" || !row.sealed
        ? minimum
        : minimum === null
          ? row.ordinal
          : Math.min(minimum, row.ordinal),
    null,
  );
  const isEarliestRange =
    chatSnapshot.earliestSealedOrdinal === null ||
    (earliestResidentOrdinal !== null &&
      earliestResidentOrdinal <= chatSnapshot.earliestSealedOrdinal);
  const historyEpoch = chatSnapshot.historyEpoch;
  const historyResource =
    historyResourceRaw?.historyEpoch === historyEpoch
      ? (historyModel?.get(historyResourceId) ?? null)
      : null;
  const putHistoryState = (state: ThreadHistoryState): void => {
    resources.putThreadHistory?.({
      connectionId,
      generation: threadOpenGeneration,
      id: historyResourceId,
      threadId,
      ...state,
    });
  };
  const projection = projectThreadChatWindow(
    chatDatabase,
    chatWindow,
    connectionId,
    threadId,
    false,
    storedThread,
  );
  const remoteThread = projection.remoteThread ?? storedThread?.provisionalThread ?? null;
  const conversationCwd =
    remoteThread?.cwd ?? storedThread?.cwd ?? conversation.cwd ?? "/workspace";
  const historyRestoreReady = !threadLoadBlocksPresentation(chatSnapshot.status);
  const messageListState: MessageListState =
    chatSnapshot.status === "initial-error"
      ? {
          message: chatSnapshot.error ?? "Could not load messages",
          retry: async () => {
            await chatDatabase.loadWindow(chatWindowRequest);
          },
          status: "error",
        }
      : historyRestoreReady
        ? { status: "ready" }
        : { status: "loading" };
  const historyState: ThreadHistoryState = historyResource ?? {
    error: null,
    historyEpoch,
    nextCursor: chatDatabase.historyCursor(connectionId, threadId),
    status: remoteThread === null ? "initial-loading" : "ready",
  };
  const readHistoryState = (): ThreadHistoryState | null => {
    const row = historyModel?.get(historyResourceId) ?? null;
    return row?.historyEpoch === historyEpoch ? row : historyState;
  };
  const historyViewport = useThreadHistoryController({
    connectionId,
    cursorState: historyState,
    enabled: true,
    historyEpoch,
    isEarliestRange,
    isLatestRange,
    pullRange: async (direction) => chatDatabase.pullRange(connectionId, threadId, direction),
    putState: putHistoryState,
    readHistoryCursor: () => chatDatabase.historyCursor(connectionId, threadId),
    readRangeRevision: () =>
      chatDatabase.chat.window$(connectionId, threadId).peek().layoutRevision,
    readState: readHistoryState,
    threadId,
    trimRange: async (direction) => chatDatabase.trimRange(connectionId, threadId, direction),
  });
  return {
    conversationCwd,
    historyRestoreReady,
    historyViewport,
    messageListState,
    projection,
    remoteThread,
  };
}
