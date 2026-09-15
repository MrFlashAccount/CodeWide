import type { ThreadForkOptions } from "../../data/thread-fork";
export type ThreadHeaderProps = {
  threadId: string;
  archived: boolean;
  pinned: boolean;
  onOpenMenu?(): void;
  onRenameRequest(): void;
  onArchive?(): Promise<void>;
  onUnarchive?(): Promise<void>;
  onCompact?(): Promise<void>;
  onFork?(options: ThreadForkOptions): Promise<void>;
  onDelete?(): Promise<void>;
  onTogglePin?(): Promise<void>;
};
