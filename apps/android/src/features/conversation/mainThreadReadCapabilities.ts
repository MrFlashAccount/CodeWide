import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import type { TurnUsageProjection } from "@codewide/sync-client";
import type { ThreadChatModel } from "../../data/thread-chat-model";
import type { ProjectedThreadChatTimelineEntry } from "../../data/thread-chat-projection";
import type { ThreadCurrentOutcome } from "../../data/thread-current-outcome";
import type { ThreadHistoryModel } from "../../data/thread-history-model";
import type { ThreadHistoryViewport } from "../../data/use-thread-history-controller";
import type { ThreadUiStateRead } from "../../data/use-thread-ui-state";
import type { MessageListState } from "../../ui/MessageListBoundary";
import type { SearchConversationWindow } from "../search/search-conversation-window";
/** Qualified capabilities consumed by the conversation owner in conversation composition. */
export type MainThreadReadCapabilities = {
  composerState: ThreadUiStateRead;
  currentOutcome: ThreadCurrentOutcome | null;
  currentUsage: TurnUsageProjection | null;
  historyActivityModel: ThreadHistoryModel | null;
  historyActivityResourceId: string | null;
  historyRestoreReady: boolean;
  historyViewport: ThreadHistoryViewport;
  liveTextRecovery: boolean;
  loadScrollOffset:
    | ((connectionId: string, threadId: string) => Promise<number | null>)
    | undefined;
  messageListState: MessageListState;
  onExitSearchHistory: (() => void) | undefined;
  onLoadTurnItems: ((turnId: string) => Promise<void>) | undefined;
  remoteLiveTurns: readonly Thread["turns"][number][] | undefined;
  remoteSealedTurns: readonly Thread["turns"][number][] | undefined;
  remoteThread: Thread | null | undefined;
  saveScrollOffset:
    | ((
        connectionId: string,
        threadId: string,
        offset: number,
        historyAnchorTurnId: string | null,
        historyAnchorOffsetPx: number | null,
      ) => Promise<void>)
    | undefined;
  searchWindow: SearchConversationWindow | null;
  threadChatModel: ThreadChatModel | null;
  timelineEntries: readonly ProjectedThreadChatTimelineEntry[] | undefined;
};
