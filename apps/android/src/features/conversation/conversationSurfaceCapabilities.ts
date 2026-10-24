import type { ThreadListServer } from "../connections/connectionPresentation";
import type { ThreadListItem } from "../threadList/threadListTypes";
import type { ReactNode } from "react";
/** Qualified capabilities consumed by the conversation owner in conversation composition. */
export type ConversationSurfaceCapabilities = {
  compact: boolean;
  cwd: string;
  firstUnreadAgentTurnId: string | null;
  headerActions: ReactNode;
  newChat: boolean;
  onBack: (() => void) | undefined;
  onViewedLatest: (() => void) | undefined;
  readOnly: boolean;
  /**
   * Re-reads the thread so the server checks again whether another app still
   * holds it; `undefined` where no thread can be open elsewhere.
   */
  recheckThread: (() => Promise<void>) | undefined;
  server: ThreadListServer | undefined;
  thread: ThreadListItem | null;
  unread: number;
};
