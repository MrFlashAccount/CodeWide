import type { ReactNode } from "react";
import type { ServerScope } from "../../services/servers/serverScope";
import type { ThreadListServer } from "../connections/connectionPresentation";
import type { ThreadListFilter } from "./threadListFilters";
import type { SidebarProjectsNavigation, ThreadListMode } from "./threadListModel";
import type { ThreadListItem } from "./threadListTypes";

/** Thread-list data and navigation actions used by the compact mobile surface. */
export type MobileThreadsProps = {
  archivedThreads: ThreadListItem[];
  filter: ThreadListFilter;
  initialOffset: number;
  mode: ThreadListMode;
  onArchive: (thread: ThreadListItem) => Promise<void>;
  onFilterChange: (filter: ThreadListFilter) => void;
  onLoadMore: () => void;
  onMarkRead: (thread: ThreadListItem) => Promise<void>;
  onModeChange: (mode: ThreadListMode) => void;
  onNewThread: () => void;
  onOffsetChange: (offset: number) => void;
  onOpenSearch: () => void;
  onPreloadThread: (id: string) => (() => void) | undefined;
  onQueryChange: (query: string) => void;
  onRefreshAccountRateLimits?: () => Promise<unknown>;
  onSelectServer: (scope: ServerScope) => void;
  onSelectThread: (id: string) => void;
  onSettings: () => void;
  onTogglePin: (thread: ThreadListItem) => Promise<void>;
  onUnarchive: (thread: ThreadListItem) => Promise<void>;
  query: string;
  searchContent: ReactNode;
  servers: ThreadListServer[];
  serverScope: ServerScope;
  threads: ThreadListItem[];
} & SidebarProjectsNavigation;
