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
import type { SearchConversationWindow } from "../search/search-conversation-window";
import { useSearchConversationWindowLifecycle } from "../search/use-search-conversation-window";
import { renderMainConversationPublication } from "./MainConversationPublication";

import { useMainConversationHistory } from "./mainConversationHistory";

import type {
  ConversationDestinationBaseProps,
  ConversationDetailResources,
} from "./conversationCapabilities";

export type MainConversationDetailProps = ConversationDestinationBaseProps & {
  connectionId: string;
  resources: ConversationDetailResources;
  threadId: string;
  threadOpenGeneration: number;
};
export type NewConversationDetailProps = ConversationDestinationBaseProps & {
  connectionId: string;
  draftId: string;
  resources: ConversationDetailResources;
};
export type ConversationDestinationProps = ConversationDestinationBaseProps & {
  route:
    | {
        connectionId: string;
        kind: "thread";
        resources: ConversationDetailResources;
        threadId: string;
        threadOpenGeneration: number;
      }
    | {
        connectionId: string;
        draftId: string;
        kind: "new";
        resources: ConversationDetailResources;
      };
};

export function MainConversationDetail({
  connectionId,
  navigationKey,
  resources,
  threadId,
  threadOpenGeneration,
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
      archivedLimit: 0,
      connectionId: null,
      recentLimit: 0,
      selectedConnectionId: connectionId,
      selectedThreadId: threadId,
      subagentConnectionId: null,
      subagentLimit: 0,
      viewId: `conversation:${connectionId}:${threadId}`,
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
  searchWindow?.read().catch(() => undefined);
  const searchState = useSelector(() => searchWindow?.state$.get() ?? null);
  const [initialHistoryAnchorTurnId, setHistoryAnchorTurnId] = useConversationState(
    `${connectionId}\u0000${threadId}`,
    () => composerState.historyAnchorTurnId ?? null,
  );
  const historyResourceId = threadHistoryResourceKey(connectionId, threadId);
  const historyModel = resources.threadHistoryModel ?? null;
  const historyResourceRaw = useThreadHistoryCursor(historyModel, historyResourceId);
  const chatWindowRequest: ThreadChatWindowRequest = {
    anchorTurnId: searchWindow === null ? initialHistoryAnchorTurnId : null,
    connectionId,
    openGeneration: threadOpenGeneration,
    threadId,
  };
  const chatWindow = useThreadChatWindow(chatDatabase, chatWindowRequest, false);
  if (chatWindow === null) {
    throw new Error("Conversation window is unavailable");
  }

  const chatSnapshot = chatWindow.snapshot;
  const history = useMainConversationHistory({
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
  });

  return renderMainConversationPublication({
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
    setHistoryAnchorTurnId,
    threadId,
  });
}
export function NewConversationDetail({
  connectionId,
  draftId,
  navigationKey: _navigationKey,
  resources,
  ...conversation
}: NewConversationDetailProps) {
  const uiStateDatabase = resources.threadUiStateDatabase;
  if (uiStateDatabase === null) {
    throw new Error("Native composer database is unavailable");
  }
  const composerState = useThreadUiState(uiStateDatabase, connectionId, draftId);
  return (
    <>
      {conversation.renderContent({
        composerState: composerState,
        cwd: conversation.cwd ?? "/workspace",
        historyRestoreReady: true,
        historyViewport: COMPLETE_STATIC_THREAD_HISTORY,
        queuedPrompts: [],
        remoteLiveTurns: [],
        remoteSealedTurns: [],
        remoteThread: null,
        searchWindow: conversation.searchWindow,
        subagentSummaryDatabase: resources.threadSummaryDatabase,
        timelineEntries: [],
      })}
    </>
  );
}
