import type { ThreadChatWindowRequest } from "../../data/thread-chat-model";
import { projectThreadChatWindow } from "../../data/thread-chat-projection";
import { threadLoadBlocksPresentation } from "../../data/thread-load-status";
import { threadWindowHistoryBounds } from "../../data/threadWindowHistoryBounds";
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
  openingReady,
  resources,
  storedThread,
  threadId,
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
  openingReady: boolean;
  resources: ConversationDetailResources;
  storedThread: StoredThreadSummary | null;
  threadId: string;
}) {
  const historyEpoch = chatSnapshot.historyEpoch;
  const historyResource =
    historyResourceRaw?.historyEpoch === historyEpoch
      ? (historyModel?.get(historyResourceId) ?? null)
      : null;
  const putHistoryState = (state: ThreadHistoryState): void => {
    resources.putThreadHistory?.({
      connectionId,
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
  const historyRestoreReady = openingReady && !threadLoadBlocksPresentation(chatSnapshot.status);
  const messageListState: MessageListState =
    chatSnapshot.status === "initial-error" ||
    (!openingReady && chatSnapshot.status === "background-retrying")
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
    bounds: threadWindowHistoryBounds(chatWindow),
    connectionId,
    enabled: true,
    historyEpoch,
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
