import type { ThreadListServer } from "../connections/connectionPresentation";
import type { ThreadListItem } from "./threadListTypes";

/** Display state and explicit actions accepted by one thread row. */
export type ThreadRowProps = {
  thread: ThreadListItem;
  server: ThreadListServer | undefined;
  selected: boolean;
  onPressIn?(): (() => void) | undefined;
  onPress(): void;
  onTogglePin?(): Promise<void>;
  onArchive?(): Promise<void>;
  onUnarchive?(): Promise<void>;
  onMarkRead?(): Promise<void>;
};
