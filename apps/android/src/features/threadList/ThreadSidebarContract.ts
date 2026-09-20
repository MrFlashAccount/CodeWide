import type { ReactNode } from "react";
import type { ServerScope } from "../../services/servers/serverScope";
import type { ThreadListServer } from "../connections/connectionPresentation";
import type { ThreadListFilter } from "./threadListFilters";
import type { SidebarProjectsNavigation, ThreadListMode } from "./threadListModel";
import type { ThreadListItem } from "./threadListTypes";
import type { GlobalVoiceControl } from "./GlobalVoiceEntryAction";

/** Thread-list state, layout, and actions used by the desktop sidebar. */
export type ThreadSidebarProps = {
  archivedThreads: ThreadListItem[];
  filter: ThreadListFilter;
  globalVoice: GlobalVoiceControl;
  initialOffset: number;
  mode: ThreadListMode;
  onArchive: (thread: ThreadListItem) => Promise<void>;
  onFilterChange: (filter: ThreadListFilter) => void;
  onLoadMore: () => void;
  onManageTerminals: () => void;
  onMarkRead: (thread: ThreadListItem) => Promise<void>;
  onModeChange: (mode: ThreadListMode) => void;
  onNewThread: () => void;
  onOffsetChange: (offset: number) => void;
  onOpenSearch: () => void;
  onRefreshAccountRateLimits?: () => Promise<unknown>;
  onSelect: (id: string) => void;
  onSelectServer: (scope: ServerScope) => void;
  onSettings: () => void;
  onTogglePin: (thread: ThreadListItem) => Promise<void>;
  onUnarchive: (thread: ThreadListItem) => Promise<void>;
  searchContent: ReactNode;
  selectedThreadKey: string | null;
  servers: ThreadListServer[];
  serverScope: ServerScope;
  threads: ThreadListItem[];
  width: number;
} & SidebarProjectsNavigation;
