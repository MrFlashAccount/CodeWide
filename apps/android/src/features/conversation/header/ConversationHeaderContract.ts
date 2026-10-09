import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import type { TurnUsageProjection } from "@codewide/sync-client";
import type { Dispatch, SetStateAction } from "react";
import type { AccountRateLimitsDatabase } from "../../../data/account-rate-limits-database";
import type { ProviderLimitsSource } from "../../accounts/conversationAccountCapabilities";
import type { ThreadChatModel } from "../../../data/thread-chat-model";
import type { ThreadForkOptions } from "../../../data/thread-fork";
import type { ThreadHistoryModel } from "../../../data/thread-history-model";
import type { ThreadListServer } from "../../connections/connectionPresentation";
import type { ReadForkTargets } from "../../turnActions/forkTargets";
import type { ThreadListItem } from "../../threadList/threadListTypes";

/** Display state and actions accepted by the conversation header. */
export type ConversationHeaderProps = {
  accountRateLimitsDatabase: AccountRateLimitsDatabase | null;
  archived: boolean;
  closeThreadSearch: () => void;
  compact: boolean;
  currentUsage: TurnUsageProjection | null;
  cwd: string;
  deleteThread: (() => Promise<void>) | undefined;
  dismissComposerKeyboardForOverlay: () => void;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  forkTargets: ReadForkTargets | undefined;
  historyActivityModel: ThreadHistoryModel | null;
  historyActivityResourceId: string | null;
  newChat: boolean;
  onArchive: (() => Promise<void>) | undefined;
  onBack: (() => void) | undefined;
  onCompact: (() => Promise<void>) | undefined;
  onFork: ((options: ThreadForkOptions) => Promise<void>) | undefined;
  onRefreshAccountRateLimits: (() => Promise<unknown>) | undefined;
  onTogglePin: (() => Promise<void>) | undefined;
  onUnarchive: (() => Promise<void>) | undefined;
  openThreadRename: () => void;
  pinned: boolean;
  /** The thread's own provider limits (a provider without an account pool); absent or `null` otherwise. */
  providerLimits?: ProviderLimitsSource | null;
  readOnly: boolean;
  remoteThread: Thread | null | undefined;
  server: ThreadListServer | undefined;
  sessionCompactionCount: number | null;
  setThreadSearchVisible: Dispatch<SetStateAction<boolean>>;
  thread: ThreadListItem;
  threadChatModel: ThreadChatModel | null;
  threadSearchVisible: boolean;
};
