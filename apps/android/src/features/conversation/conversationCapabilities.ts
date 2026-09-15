import type { Thread, Turn } from "@codewide/codex-protocol/v0.147.0/v2";
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
import type { ThreadUiStateRow } from "../../data/thread-ui-state-types";
import type { ThreadHistoryViewport } from "../../data/use-thread-history-controller";
import type { MessageListState } from "../../ui/MessageListBoundary";
import type { SearchConversationWindow } from "../search/search-conversation-window";
/** Existing qualified model handles and history mutation authority for destination reads. */
export type ConversationDetailResources = {
  threadDetails: ThreadDetailDatabase | null;
  threadUiStateDatabase: ThreadUiStateDatabase | null;
  threadSummaryDatabase: ThreadSummaryDatabase | null;
  threadHistoryModel: ThreadHistoryModel | null;
  putThreadHistory: ((row: Omit<ThreadHistoryRow, "updatedAt">) => void) | undefined;
  loadTurnItems(connectionId: string, threadId: string, turnId: string): Promise<Turn["items"]>;
};
/** A progressive transcript snapshot published after local editor restoration. */
export type ConversationDetailSnapshot = {
  remoteThread: Thread | null;
  remoteSealedTurns: readonly Turn[];
  remoteLiveTurns: readonly Turn[];
  timelineEntries: readonly ProjectedThreadChatTimelineEntry[];
  queuedPrompts: QueuedPrompt[];
  composerState: ThreadUiStateRow;
  historyRestoreReady: boolean;
  historyViewport: ThreadHistoryViewport;
  subagentSummaryDatabase: ThreadSummaryDatabase | null;
  searchWindow?: SearchConversationWindow | null;
  liveTextRecovery?: boolean;
  cwd?: string;
  currentUsage?: TurnUsageProjection | null;
  currentOutcome?: ThreadCurrentOutcome | null;
  messageListState?: MessageListState;
  historyActivityModel?: ThreadHistoryModel | null;
  historyActivityResourceId?: string;
  threadChatModel?: ThreadChatModel;
  onLoadTurnItems?(turnId: string): Promise<void>;
};
/** Destination metadata plus a presentation slot; no composer or tool implementation crosses this boundary. */
export type ConversationDestinationBaseProps = {
  navigationKey: string;
  searchWindow: SearchConversationWindow | null;
  cwd: string | undefined;
  onExitSearchHistory: (() => void) | undefined;
  renderContent(snapshot: ConversationDetailSnapshot): ReactNode;
};
