import { useSelector } from "@legendapp/state/react";
import type { ThreadChatWindowRequest } from "../../data/thread-chat-model";
import { useThreadChatWindow } from "../../data/use-thread-chat-window";
import { useThreadHistoryCursor } from "../../data/use-thread-history";
import { COMPLETE_STATIC_THREAD_HISTORY } from "../../data/use-thread-history-controller";
import { useThreadSummaryView } from "../../data/use-thread-summary-view";
import { useThreadUiState } from "../../data/use-thread-ui-state";
import { threadHistoryResourceKey } from "../../data/workspace-resource-keys";
import { useEvent } from "../../react/useEvent";
import { useConversationState } from "../../ui/use-conversation-scope";
import { SearchConversationWindow } from "../search/search-conversation-window";
import { useSearchConversationWindowLifecycle } from "../search/use-search-conversation-window";
import { renderMainConversationPublication } from "./MainConversationPublication";

import { useMainConversationHistory } from "./mainConversationHistory";

import type {
  ConversationDestinationBaseProps,
  ConversationDetailResources,
} from "./conversationCapabilities";

export type MainConversationDetailProps = ConversationDestinationBaseProps & {
  resources: ConversationDetailResources;
  connectionId: string;
  threadId: string;
  threadOpenGeneration: number;
};
export type NewConversationDetailProps = ConversationDestinationBaseProps & {
  resources: ConversationDetailResources;
  connectionId: string;
  draftId: string;
};
export type ConversationDestinationProps = ConversationDestinationBaseProps & {
  route:
    | {
        kind: "thread";
        resources: ConversationDetailResources;
        connectionId: string;
        threadId: string;
        threadOpenGeneration: number;
      }
    | {
        kind: "new";
        resources: ConversationDetailResources;
        connectionId: string;
        draftId: string;
      };
};

export function MainConversationDetail({
  resources,
  connectionId,
  threadId,
  threadOpenGeneration,
  navigationKey,
  ...conversation
}: MainConversationDetailProps) {
  const uiStateDatabase = resources.threadUiStateDatabase;
  const chatDatabase = resources.threadDetails;
  if (uiStateDatabase === null || chatDatabase === null) {
    throw new Error("Native conversation databases are unavailable");
  }

  const summaryView = useThreadSummaryView(
    resources.threadSummaryDatabase,
    {
      // Metadata and history load independently; route/catalog metadata already
      // provides the header and actions while this summary is being restored.
      viewId: `conversation:${connectionId}:${threadId}`,
      connectionId: null,
      recentLimit: 0,
      archivedLimit: 0,
      selectedConnectionId: connectionId,
      selectedThreadId: threadId,
      subagentConnectionId: null,
      subagentLimit: 0,
    },
    false,
  );
  const storedThread = summaryView?.selected[0] ?? null;
  const composerState = useThreadUiState(uiStateDatabase, connectionId, threadId);
  const searchWindow =
    conversation.searchWindow?.target.connectionId === connectionId &&
    conversation.searchWindow.target.hit.threadId === threadId
      ? conversation.searchWindow
      : null;
  useSearchConversationWindowLifecycle(searchWindow);
  const isSelectedSearchWindow = useEvent(
    (selected: SearchConversationWindow) => searchWindow === selected,
  );
  // The selected window owns its cached promise. A chat-keyed resource would
  // reuse the first result when another message in that same chat is selected.
  void searchWindow?.read();
  const searchState = useSelector(() => searchWindow?.state$.get() ?? null);
  const [initialHistoryAnchorTurnId, setHistoryAnchorTurnId] = useConversationState(
    `${connectionId}\u0000${threadId}`,
    () => composerState.historyAnchorTurnId ?? null,
  );
  const historyResourceId = threadHistoryResourceKey(connectionId, threadId);
  const historyModel = resources.threadHistoryModel ?? null;
  const historyResourceRaw = useThreadHistoryCursor(historyModel, historyResourceId);
  const chatWindowRequest: ThreadChatWindowRequest = {
    connectionId,
    threadId,
    anchorTurnId: searchWindow === null ? initialHistoryAnchorTurnId : null,
    openGeneration: threadOpenGeneration,
  };
  const chatWindow = useThreadChatWindow(chatDatabase, chatWindowRequest, false);
  if (chatWindow === null) throw new Error("Conversation window is unavailable");

  const chatSnapshot = chatWindow.snapshot;
  const history = useMainConversationHistory({
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
  });

  return renderMainConversationPublication({
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
  });
}
export function NewConversationDetail({
  resources,
  connectionId,
  draftId,
  navigationKey,
  ...conversation
}: NewConversationDetailProps) {
  const uiStateDatabase = resources.threadUiStateDatabase;
  if (uiStateDatabase === null) throw new Error("Native composer database is unavailable");
  const composerState = useThreadUiState(uiStateDatabase, connectionId, draftId);
  return (
    <>
      {conversation.renderContent({
        cwd: conversation.cwd ?? "/workspace",
        searchWindow: conversation.searchWindow,
        remoteThread: null,
        remoteSealedTurns: [],
        remoteLiveTurns: [],
        timelineEntries: [],
        queuedPrompts: [],
        composerState: composerState,
        historyRestoreReady: true,
        historyViewport: COMPLETE_STATIC_THREAD_HISTORY,
        subagentSummaryDatabase: resources.threadSummaryDatabase,
      })}
    </>
  );
}
