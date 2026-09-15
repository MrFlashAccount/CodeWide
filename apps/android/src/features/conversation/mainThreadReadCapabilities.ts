import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import type { TurnUsageProjection } from "@codewide/sync-client";
import type { ThreadChatModel } from "../../data/thread-chat-model";
import type { ProjectedThreadChatTimelineEntry } from "../../data/thread-chat-projection";
import type { ThreadCurrentOutcome } from "../../data/thread-current-outcome";
import type { ThreadHistoryModel } from "../../data/thread-history-model";
import type { ThreadUiStateRow } from "../../data/thread-ui-state-types";
import type { ThreadHistoryViewport } from "../../data/use-thread-history-controller";
import type { MessageListState } from "../../ui/MessageListBoundary";
import { SearchConversationWindow } from "../search/search-conversation-window";
/** Qualified capabilities consumed by the conversation owner in conversation composition. */
export type MainThreadReadCapabilities = {
  searchWindow: SearchConversationWindow | null;
  onExitSearchHistory: (() => void) | undefined;
  remoteThread: Thread | null | undefined;
  currentUsage: TurnUsageProjection | null;
  currentOutcome: ThreadCurrentOutcome | null;
  remoteSealedTurns: readonly Thread["turns"][number][] | undefined;
  remoteLiveTurns: readonly Thread["turns"][number][] | undefined;
  timelineEntries: readonly ProjectedThreadChatTimelineEntry[] | undefined;
  historyViewport: ThreadHistoryViewport;
  historyActivityModel: ThreadHistoryModel | null;
  historyActivityResourceId: string | null;
  threadChatModel: ThreadChatModel | null;
  onLoadTurnItems: ((turnId: string) => Promise<void>) | undefined;
  composerState: ThreadUiStateRow | null;
  historyRestoreReady: boolean;
  messageListState: MessageListState;
  liveTextRecovery: boolean;
  loadScrollOffset:
    | ((connectionId: string, threadId: string) => Promise<number | null>)
    | undefined;
  saveScrollOffset:
    | ((
        connectionId: string,
        threadId: string,
        offset: number,
        historyAnchorTurnId: string | null,
        historyAnchorOffsetPx: number | null,
      ) => Promise<void>)
    | undefined;
};
