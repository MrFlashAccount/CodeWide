import type { ThreadForkOptions } from "../../data/thread-fork";
/** Qualified capabilities consumed by the turnActions owner in conversation composition. */
export type ThreadConversationCapabilities = {
  onRename: ((name: string) => Promise<void>) | undefined;
  onArchive: (() => Promise<void>) | undefined;
  onUnarchive: (() => Promise<void>) | undefined;
  onDelete: (() => Promise<void>) | undefined;
  archived: boolean;
  pinned: boolean;
  onTogglePin: (() => Promise<void>) | undefined;
  onCompact: (() => Promise<void>) | undefined;
  onFork: ((options: ThreadForkOptions) => Promise<void>) | undefined;
};
