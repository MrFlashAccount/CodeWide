import type { ThreadListServer } from "../connections/connectionPresentation";
import type { ThreadListItem } from "./threadListTypes";

/** Display state and explicit actions accepted by one thread row. */
export type ThreadRowProps = {
  onArchive?: () => Promise<void>;
  onMarkRead?: () => Promise<void>;
  onPress: () => void;
  onPressIn?: () => (() => void) | undefined;
  onTogglePin?: () => Promise<void>;
  onUnarchive?: () => Promise<void>;
  selected: boolean;
  server: ThreadListServer | undefined;
  thread: ThreadListItem;
};
