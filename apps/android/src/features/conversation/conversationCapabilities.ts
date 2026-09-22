import type { Thread, Turn } from "@codewide/codex-protocol/v0.155.1/v2";
import type { TurnUsageProjection } from "@codewide/sync-client";
import type { ReactNode } from "react";
import type { ThreadChatModel } from "../../data/thread-chat-model";
import type { ProjectedThreadChatTimelineEntry } from "../../data/thread-chat-projection";
import type { ThreadCurrentOutcome } from "../../data/thread-current-outcome";
import type { QueuedPrompt } from "../../data/thread-delivery-state";
import type { ThreadDetailDatabase } from "../../data/thread-detail-database-contract";
import type { ThreadHistoryModel, ThreadHistoryRow } from "../../data/thread-history-model";
import type { ThreadSummaryDatabase } from "../../data/thread-summary-database";
import type { ThreadUiStateDatabase } from "../../data/thread-ui-state-database-contract";
import type { ThreadHistoryViewport } from "../../data/use-thread-history-controller";
import type { ThreadUiStateRead } from "../../data/use-thread-ui-state";
import type { MessageListState } from "../../ui/MessageListBoundary";
import type { SearchConversationWindow } from "../search/search-conversation-window";
/** Existing qualified model handles and history mutation authority for destination reads. */
export type ConversationDetailResources = {
  loadTurnItems: (connectionId: string, threadId: string, turnId: string) => Promise<Turn["items"]>;
  putThreadHistory: ((row: Omit<ThreadHistoryRow, "updatedAt">) => void) | undefined;
  threadDetails: ThreadDetailDatabase | null;
  threadHistoryModel: ThreadHistoryModel | null;
  threadSummaryDatabase: ThreadSummaryDatabase | null;
  threadUiStateDatabase: ThreadUiStateDatabase | null;
};
/** A progressive transcript snapshot published after local editor restoration. */
export type ConversationDetailSnapshot = {
  composerState: ThreadUiStateRead;
  currentOutcome?: ThreadCurrentOutcome | null;
  currentUsage?: TurnUsageProjection | null;
  cwd?: string;
  historyActivityModel?: ThreadHistoryModel | null;
  historyActivityResourceId?: string;
  historyRestoreReady: boolean;
  historyViewport: ThreadHistoryViewport;
  liveTextRecovery?: boolean;
  messageListState?: MessageListState;
  onLoadTurnItems?: (turnId: string) => Promise<void>;
  queuedPrompts: QueuedPrompt[];
  remoteLiveTurns: readonly Turn[];
  remoteSealedTurns: readonly Turn[];
  remoteThread: Thread | null;
  searchWindow?: SearchConversationWindow | null;
  subagentSummaryDatabase: ThreadSummaryDatabase | null;
  threadChatModel?: ThreadChatModel;
  timelineEntries: readonly ProjectedThreadChatTimelineEntry[];
};
/** Destination metadata plus a presentation slot; no composer or tool implementation crosses this boundary. */
export type ConversationDestinationBaseProps = {
  cwd: string | undefined;
  navigationKey: string;
  onExitSearchHistory: (() => void) | undefined;
  renderContent: (snapshot: ConversationDetailSnapshot) => ReactNode;
  searchWindow: SearchConversationWindow | null;
};
