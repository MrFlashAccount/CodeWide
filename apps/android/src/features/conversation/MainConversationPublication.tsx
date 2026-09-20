import { startTransition } from "react";
import type { ThreadChatWindowRequest } from "../../data/thread-chat-model";
import { recordThreadNavigationVisualEvent } from "../../data/thread-navigation-metrics";
import type { useThreadChatWindow } from "../../data/use-thread-chat-window";
import type { useThreadHistoryCursor } from "../../data/use-thread-history";
import type { useThreadUiState } from "../../data/use-thread-ui-state";
import type { threadHistoryResourceKey } from "../../data/workspace-resource-keys";
import { CommitOnChangeProbe } from "../../ui/CommitProbe";
import type { SearchConversationWindow } from "../search/search-conversation-window";
import type {
  ConversationDestinationBaseProps,
  ConversationDetailResources,
} from "./conversationCapabilities";
import type { useMainConversationHistory } from "./mainConversationHistory";

/** Publishes cached conversation content and commit markers while history hydrates progressively. */
export function renderMainConversationPublication({
  chatDatabase,
  chatSnapshot,
  chatWindow,
  chatWindowRequest,
  composerState,
  connectionId,
  conversation,
  history,
  historyModel,
  historyResourceId,
  historyResourceRaw,
  isSelectedSearchWindow,
  navigationKey,
  resources,
  searchState,
  searchWindow,
  threadId,
}: {
  chatDatabase: NonNullable<ConversationDetailResources["threadDetails"]>;
  chatSnapshot: NonNullable<ReturnType<typeof useThreadChatWindow>>["snapshot"];
  chatWindow: NonNullable<ReturnType<typeof useThreadChatWindow>>;
  chatWindowRequest: ThreadChatWindowRequest;
  composerState: ReturnType<typeof useThreadUiState>;
  connectionId: string;
  conversation: Omit<ConversationDestinationBaseProps, "navigationKey">;
  history: ReturnType<typeof useMainConversationHistory>;
  historyModel: ConversationDetailResources["threadHistoryModel"];
  historyResourceId: ReturnType<typeof threadHistoryResourceKey>;
  historyResourceRaw: ReturnType<typeof useThreadHistoryCursor>;
  isSelectedSearchWindow: (candidate: SearchConversationWindow) => boolean;
  navigationKey: ConversationDestinationBaseProps["navigationKey"];
  resources: ConversationDetailResources;
  searchState: ReturnType<SearchConversationWindow["state$"]["peek"]> | null;
  searchWindow: SearchConversationWindow | null;
  threadId: string;
}) {
  return (
    <>
      <CommitOnChangeProbe
        onCommit={() => {
          const navigationId = recordThreadNavigationVisualEvent(
            connectionId,
            threadId,
            "conversation_destination_visible",
          );
          return navigationId === null
            ? undefined
            : () =>
                recordThreadNavigationVisualEvent(
                  connectionId,
                  threadId,
                  "conversation_destination_hidden_or_unmounted",
                  {},
                  navigationId,
                );
        }}
        revision={navigationKey}
        scope={`main-conversation:${navigationKey}`}
      />
      <CommitOnChangeProbe
        onCommit={() => {
          recordThreadNavigationVisualEvent(connectionId, threadId, "chat_window_committed", {
            tags: {
              history: historyResourceRaw === null ? "missing" : "resident",
              request: chatWindowRequest.anchorTurnId === null ? "tail" : "anchor",
              status: chatSnapshot.status,
            },
            values: {
              contentRevision: chatSnapshot.revision,
              detailRows: chatWindow.detailRows.length,
              historyEpoch: chatSnapshot.historyEpoch,
              layoutRevision: chatSnapshot.layoutRevision,
              liveRows: chatWindow.liveRows.length,
              residentTurnLimit: chatSnapshot.residentTurnLimit,
              turnRows: chatWindow.turnRows.length,
            },
          });
        }}
        revision={`${chatSnapshot.requestKey ?? "none"}:${chatSnapshot.status}:${String(chatSnapshot.layoutRevision)}:${String(chatSnapshot.revision)}:${String(chatWindow.turnRows.length)}:${String(chatWindow.detailRows.length)}:${String(chatWindow.liveRows.length)}`}
        scope={`main-window:${navigationKey}`}
      />
      {conversation.renderContent({
        composerState: composerState,
        currentOutcome: history.projection.currentOutcome,
        currentUsage: history.projection.currentUsage,
        cwd: history.conversationCwd,
        historyActivityModel: historyModel,
        historyActivityResourceId: historyResourceId,
        historyRestoreReady:
          searchState === null ? history.historyRestoreReady : searchState.page !== null,
        historyViewport:
          searchWindow === null
            ? history.historyViewport
            : {
                completeTurnHeaders: false,
                containsBeginning: false,
                containsLatest: false,
                loadLatest: async () => {
                  searchWindow.cancelViewportFill();
                  await history.historyViewport.loadLatest();
                  if (!isSelectedSearchWindow(searchWindow)) {
                    return;
                  }
                  startTransition(() => {
                    conversation.onExitSearchHistory?.();
                  });
                },
                loadNewer: async () => {
                  await searchWindow.loadRange("newer");
                },
                loadOlder: async () => {
                  await searchWindow.loadRange("older");
                },
                readStatus: () =>
                  searchWindow.state$.peek().status === "loading" ? "loading-history" : "ready",
                reportViewport: async (viewportHeight, contentHeight) => {
                  await searchWindow.reportViewport(viewportHeight, contentHeight);
                },
                trimAfterGesture: async () => {},
              },
        liveTextRecovery: chatSnapshot.backendRefreshing,
        messageListState:
          searchState === null
            ? history.messageListState
            : searchState.status === "error"
              ? {
                  message: searchState.message,
                  retry: async () => searchWindow?.retry(),
                  status: "error",
                }
              : searchState.page !== null
                ? { status: "ready" }
                : { status: "loading" },
        onLoadTurnItems: async (turnId) => {
          const items = await resources.loadTurnItems(connectionId, threadId, turnId);
          searchWindow?.replaceItems(turnId, items);
        },
        queuedPrompts: history.projection.queuedPrompts,
        remoteLiveTurns: history.projection.remoteLiveTurns,
        remoteSealedTurns: history.projection.remoteSealedTurns,
        remoteThread: history.remoteThread,
        searchWindow: searchWindow,
        subagentSummaryDatabase: resources.threadSummaryDatabase,
        threadChatModel: chatDatabase.chat,
        timelineEntries:
          searchState === null
            ? history.projection.timeline
            : (searchState.page?.turns ?? []).map((turn) => ({ kind: "turn", turn })),
      })}
    </>
  );
}
