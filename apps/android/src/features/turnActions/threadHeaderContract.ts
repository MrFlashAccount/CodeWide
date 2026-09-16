import type { ThreadForkOptions } from "../../data/thread-fork";

/** Thread identity, state, and mutation actions exposed to its header. */
export type ThreadHeaderProps = {
  archived: boolean;
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
