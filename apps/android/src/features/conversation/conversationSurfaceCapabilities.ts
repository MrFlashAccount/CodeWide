import type { ThreadListServer } from "../connections/connectionPresentation";
import type { ThreadListItem } from "../threadList/threadListTypes";
/** Qualified capabilities consumed by the conversation owner in conversation composition. */
export type ConversationSurfaceCapabilities = {
  compact: boolean;
  cwd: string;
  newChat: boolean;
  onBack: (() => void) | undefined;
  onViewedLatest: (() => void) | undefined;
  readOnly: boolean;
  server: ThreadListServer | undefined;
  thread: ThreadListItem | null;
  unread: number;
};
