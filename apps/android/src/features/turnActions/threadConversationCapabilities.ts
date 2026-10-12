import type { ThreadForkOptions } from "../../data/thread-fork";
import type { ReadForkOffer } from "./forkTargets";
/** Qualified capabilities consumed by the turnActions owner in conversation composition. */
export type ThreadConversationCapabilities = {
  archived: boolean;
  /** The thread's fork offer, read when the user forks; `undefined` without a fork. */
  forkOffer: ReadForkOffer | undefined;
  onArchive: (() => Promise<void>) | undefined;
  onCompact: (() => Promise<void>) | undefined;
  onDelete: (() => Promise<void>) | undefined;
  onFork: ((options: ThreadForkOptions) => Promise<void>) | undefined;
  onRename: ((name: string) => Promise<void>) | undefined;
  onTogglePin: (() => Promise<void>) | undefined;
  onUnarchive: (() => Promise<void>) | undefined;
  pinned: boolean;
};
