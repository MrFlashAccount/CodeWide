import type { ThreadChatWindowRequest } from "../../data/thread-chat-model";
import { projectThreadChatWindow } from "../../data/thread-chat-projection";
import { threadLoadBlocksPresentation } from "../../data/thread-load-status";
import { type ThreadHistoryState } from "../../data/thread-pagination";
import type { StoredThreadSummary } from "../../data/thread-summary-types";
import { useThreadChatWindow } from "../../data/use-thread-chat-window";
import { useThreadHistoryCursor } from "../../data/use-thread-history";
import { useThreadHistoryController } from "../../data/use-thread-history-controller";
import { threadHistoryResourceKey } from "../../data/workspace-resource-keys";
import { type MessageListState } from "../../ui/MessageListBoundary";
import type {
  ConversationDestinationBaseProps,
  ConversationDetailResources,
} from "./conversationCapabilities";

/** Binds existing scoped owners in their original hook order; owns no replacement state. */
export function useMainConversationHistory({
  chatWindow,
  chatSnapshot,
  historyResourceRaw,
  historyModel,
  historyResourceId,
  resources,
  connectionId,
  threadId,
  threadOpenGeneration,
  chatDatabase,
  storedThread,
  conversation,
  chatWindowRequest,
}: {
  chatWindow: NonNullable<ReturnType<typeof useThreadChatWindow>>;
  chatSnapshot: NonNullable<ReturnType<typeof useThreadChatWindow>>["snapshot"];
  historyResourceRaw: ReturnType<typeof useThreadHistoryCursor>;
  historyModel: ConversationDetailResources["threadHistoryModel"];
  historyResourceId: ReturnType<typeof threadHistoryResourceKey>;
  resources: ConversationDetailResources;
  connectionId: string;
  threadId: string;
  threadOpenGeneration: number;
  chatDatabase: NonNullable<ConversationDetailResources["threadDetails"]>;
  storedThread: StoredThreadSummary | null;
  conversation: Omit<ConversationDestinationBaseProps, "navigationKey">;
  chatWindowRequest: ThreadChatWindowRequest;
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
      id: historyResourceId,
      connectionId,
      threadId,
      generation: threadOpenGeneration,
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
          status: "error",
          message: chatSnapshot.error ?? "Could not load messages",
          retry: async () => await chatDatabase.loadWindow(chatWindowRequest),
        }
      : historyRestoreReady
        ? { status: "ready" }
        : { status: "loading" };
  const historyState: ThreadHistoryState = historyResource ?? {
    historyEpoch,
    status: remoteThread === null ? "initial-loading" : "ready",
    nextCursor: chatDatabase.historyCursor(connectionId, threadId),
    error: null,
  };
  const readHistoryState = (): ThreadHistoryState | null => {
    const row = historyModel?.get(historyResourceId) ?? null;
    return row?.historyEpoch === historyEpoch ? row : historyState;
  };
  const historyViewport = useThreadHistoryController({
    enabled: true,
    connectionId,
    threadId,
    historyEpoch,
    cursorState: historyState,
    readState: readHistoryState,
    readHistoryCursor: () => chatDatabase.historyCursor(connectionId, threadId),
    readRangeRevision: () =>
      chatDatabase.chat.window$(connectionId, threadId).peek().layoutRevision,
    isLatestRange,
    isEarliestRange,
    putState: putHistoryState,
    pullRange: async (direction) => await chatDatabase.pullRange(connectionId, threadId, direction),
    trimRange: async (direction) => await chatDatabase.trimRange(connectionId, threadId, direction),
  });
  return {
    projection,
    remoteThread,
    conversationCwd,
    historyRestoreReady,
    messageListState,
    historyViewport,
  };
}
