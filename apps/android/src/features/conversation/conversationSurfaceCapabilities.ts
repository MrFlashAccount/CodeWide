import type { ThreadListServer } from "../connections/connectionPresentation";
import type { ThreadListItem } from "../threadList/threadListTypes";
/** Qualified capabilities consumed by the conversation owner in conversation composition. */
export type ConversationSurfaceCapabilities = {
  thread: ThreadListItem | null;
  server: ThreadListServer | undefined;
  newChat: boolean;
  compact: boolean;
  readOnly: boolean;
  onBack: (() => void) | undefined;
  cwd: string;
  unread: number;
  onViewedLatest: (() => void) | undefined;
};
