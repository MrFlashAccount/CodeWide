import type { ThreadForkOptions } from "../../data/thread-fork";
import type { ForkTargetPicker } from "./forkTargetPicker";
import type { ReadForkTargets } from "./forkTargets";

/** Thread identity, state, and mutation actions exposed to its header. */
export type ThreadHeaderProps = {
  archived: boolean;
  /** The conversation's "Fork into" picker, shared with the composer; absent forks at once. */
  forkPicker?: ForkTargetPicker;
  /** Fork targets read when the user forks; absent or `null` forks with the same agent at once. */
  forkTargets?: ReadForkTargets;
  onArchive?: () => Promise<void>;
  onCompact?: () => Promise<void>;
  onDelete?: () => Promise<void>;
  onFork?: (options: ThreadForkOptions) => Promise<void>;
  onOpenMenu?: () => void;
  onRenameRequest: () => void;
  onTogglePin?: () => Promise<void>;
  onUnarchive?: () => Promise<void>;
  pinned: boolean;
  threadId: string;
};
