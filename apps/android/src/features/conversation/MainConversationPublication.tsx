import type { Dispatch, SetStateAction } from "react";
import { startTransition } from "react";
import type { ThreadChatWindowRequest } from "../../data/thread-chat-model";
import { recordThreadNavigationVisualEvent } from "../../data/thread-navigation-metrics";
import { useThreadChatWindow } from "../../data/use-thread-chat-window";
import { useThreadHistoryCursor } from "../../data/use-thread-history";
import { useThreadUiState } from "../../data/use-thread-ui-state";
import { threadHistoryResourceKey } from "../../data/workspace-resource-keys";
import { CommitOnChangeProbe } from "../../ui/CommitProbe";
import { SearchConversationWindow } from "../search/search-conversation-window";
import type {
  ConversationDestinationBaseProps,
  ConversationDetailResources,
} from "./conversationCapabilities";
import { useMainConversationHistory } from "./mainConversationHistory";

/** Publishes cached conversation content and commit markers while history hydrates progressively. */
export function renderMainConversationPublication({
  navigationKey,
  connectionId,
  threadId,
  chatSnapshot,
  chatWindow,
  chatWindowRequest,
  historyResourceRaw,
  chatDatabase,
  conversation,
  searchWindow,
  history,
  searchState,
  composerState,
  isSelectedSearchWindow,
  setHistoryAnchorTurnId,
  historyModel,
  historyResourceId,
  resources,
}: {
  navigationKey: ConversationDestinationBaseProps["navigationKey"];
  connectionId: string;
  threadId: string;
  chatSnapshot: NonNullable<ReturnType<typeof useThreadChatWindow>>["snapshot"];
  chatWindow: NonNullable<ReturnType<typeof useThreadChatWindow>>;
  chatWindowRequest: ThreadChatWindowRequest;
  historyResourceRaw: ReturnType<typeof useThreadHistoryCursor>;
  chatDatabase: NonNullable<ConversationDetailResources["threadDetails"]>;
  conversation: Omit<ConversationDestinationBaseProps, "navigationKey">;
  searchWindow: SearchConversationWindow | null;
  history: ReturnType<typeof useMainConversationHistory>;
  searchState: ReturnType<SearchConversationWindow["state$"]["peek"]> | null;
  composerState: ReturnType<typeof useThreadUiState>;
  isSelectedSearchWindow: (candidate: SearchConversationWindow) => boolean;
  setHistoryAnchorTurnId: Dispatch<SetStateAction<string | null>>;
  historyModel: ConversationDetailResources["threadHistoryModel"];
  historyResourceId: ReturnType<typeof threadHistoryResourceKey>;
  resources: ConversationDetailResources;
}) {
  return (
    <>
      <CommitOnChangeProbe
        scope={`main-conversation:${navigationKey}`}
        revision={navigationKey}
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
      />
      <CommitOnChangeProbe
        scope={`main-window:${navigationKey}`}
        revision={`${chatSnapshot.requestKey ?? "none"}:${chatSnapshot.status}:${chatSnapshot.layoutRevision}:${chatSnapshot.revision}:${chatWindow.turnRows.length}:${chatWindow.detailRows.length}:${chatWindow.liveRows.length}`}
        onCommit={() => {
          recordThreadNavigationVisualEvent(connectionId, threadId, "chat_window_committed", {
            values: {
              historyEpoch: chatSnapshot.historyEpoch,
              residentTurnLimit: chatSnapshot.residentTurnLimit,
              layoutRevision: chatSnapshot.layoutRevision,
              contentRevision: chatSnapshot.revision,
              turnRows: chatWindow.turnRows.length,
              detailRows: chatWindow.detailRows.length,
              liveRows: chatWindow.liveRows.length,
            },
            tags: {
              status: chatSnapshot.status,
              request: chatWindowRequest.anchorTurnId === null ? "tail" : "anchor",
              history: historyResourceRaw === null ? "missing" : "resident",
            },
          });
        }}
      />
      <CommitOnChangeProbe
        scope={`main-presentation:${navigationKey}`}
        revision={navigationKey}
        onCommit={() => chatDatabase.chat.finishPresentation(connectionId, threadId)}
      />
      {conversation.renderContent({
        searchWindow: searchWindow,
        liveTextRecovery: chatSnapshot.backendRefreshing,
        cwd: history.conversationCwd,
        remoteThread: history.remoteThread,
        currentUsage: history.projection.currentUsage,
        currentOutcome: history.projection.currentOutcome,
        remoteSealedTurns: history.projection.remoteSealedTurns,
        remoteLiveTurns: history.projection.remoteLiveTurns,
        timelineEntries:
          searchState === null
            ? history.projection.timeline
            : (searchState.page?.turns ?? []).map((turn) => ({ kind: "turn", turn })),
        queuedPrompts: history.projection.queuedPrompts,
        composerState: composerState,
        historyRestoreReady:
          searchState === null ? history.historyRestoreReady : searchState.page !== null,
        messageListState:
          searchState === null
            ? history.messageListState
            : searchState.status === "error"
              ? {
                  status: "error",
                  message: searchState.message,
                  retry: async () => await searchWindow?.retry(),
                }
              : searchState.page !== null
                ? { status: "ready" }
                : { status: "loading" },
        historyViewport:
          searchWindow === null
            ? history.historyViewport
            : {
                readStatus: () =>
                  searchWindow.state$.peek().status === "loading" ? "loading-history" : "ready",
                completeTurnHeaders: false,
                containsBeginning: false,
                containsLatest: false,
                loadOlder: async () => await searchWindow.loadRange("older"),
                loadNewer: async () => await searchWindow.loadRange("newer"),
                loadLatest: async () => {
                  searchWindow.cancelViewportFill();
                  await history.historyViewport.loadLatest();
                  if (!isSelectedSearchWindow(searchWindow)) return;
                  startTransition(() => {
                    setHistoryAnchorTurnId(null);
                    conversation.onExitSearchHistory?.();
                  });
                },
                reportViewport: async (viewportHeight, contentHeight) =>
                  await searchWindow.reportViewport(viewportHeight, contentHeight),
                trimAfterGesture: async () => {},
              },
        historyActivityModel: historyModel,
        historyActivityResourceId: historyResourceId,
        threadChatModel: chatDatabase.chat,
        onLoadTurnItems: async (turnId) => {
          const items = await resources.loadTurnItems(connectionId, threadId, turnId);
          searchWindow?.replaceItems(turnId, items);
        },
        subagentSummaryDatabase: resources.threadSummaryDatabase,
      })}
    </>
  );
}
