import type { ThreadLink } from "../../services/threads/threadNavigationService";
import type { ThreadListServer } from "../connections/connectionPresentation";
import type { ThreadListItem } from "./threadListTypes";

/** Display state and explicit actions accepted by one thread row. */
export type ThreadRowProps = {
  link: ThreadLink;
  onArchive?: () => Promise<void>;
  onNavigate: () => void;
  onTogglePin?: () => Promise<void>;
  onToggleRead?: () => Promise<void>;
  onUnarchive?: () => Promise<void>;
  selected: boolean;
  server: ThreadListServer | undefined;
  thread: ThreadListItem;
};
