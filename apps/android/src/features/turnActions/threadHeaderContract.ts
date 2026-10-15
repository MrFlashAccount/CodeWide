import type { ThreadForkOptions } from "../../data/thread-fork";
import type { ForkTargetPicker } from "./forkTargetPicker";
import type { ReadForkOffer } from "./forkTargets";

/** Thread identity, state, and mutation actions exposed to its header. */
export type ThreadHeaderProps = {
  archived: boolean;
  /** The thread's fork offer, read when the user forks; absent disables "Fork thread". */
  forkOffer?: ReadForkOffer;
  /** The conversation's "Fork" sheet; absent disables "Fork thread". */
  forkPicker?: ForkTargetPicker;
  onArchive?: () => Promise<void>;
  onCompact?: () => Promise<void>;
  onDelete?: () => Promise<void>;
  onFork?: (options: ThreadForkOptions) => Promise<void>;
  onOpenMenu?: () => void;
  onRenameRequest: () => void;
  onTogglePin?: () => Promise<void>;
  onUnarchive?: () => Promise<void>;
  /**
   * Another app holds the thread: actions that need its session (compacting
   * it, deleting it from under the running app) are off, the rest stay.
   */
  openElsewhere?: boolean;
  pinned: boolean;
  threadId: string;
};
