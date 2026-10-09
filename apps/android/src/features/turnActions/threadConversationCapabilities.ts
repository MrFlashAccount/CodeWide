import type { ThreadForkOptions } from "../../data/thread-fork";
import type { ReadForkTargets } from "./forkTargets";
/** Qualified capabilities consumed by the turnActions owner in conversation composition. */
export type ThreadConversationCapabilities = {
  archived: boolean;
  /** Fork targets of the thread, read when the user forks; `undefined` without a fork. */
  forkTargets: ReadForkTargets | undefined;
  onArchive: (() => Promise<void>) | undefined;
  onCompact: (() => Promise<void>) | undefined;
  onDelete: (() => Promise<void>) | undefined;
  onFork: ((options: ThreadForkOptions) => Promise<void>) | undefined;
  onRename: ((name: string) => Promise<void>) | undefined;
  onTogglePin: (() => Promise<void>) | undefined;
  onUnarchive: (() => Promise<void>) | undefined;
  pinned: boolean;
};
