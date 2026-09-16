import type { ReactNode } from "react";
import type { ServerScope } from "../../services/servers/serverScope";
import type { ThreadListServer } from "../connections/connectionPresentation";
import type { ThreadListFilter } from "./threadListFilters";
import type { SidebarProjectsNavigation, ThreadListMode } from "./threadListModel";
import type { ThreadListItem } from "./threadListTypes";

/** Thread-list data and navigation actions used by the compact mobile surface. */
export type MobileThreadsProps = {
  servers: ThreadListServer[];
  serverScope: ServerScope;
  threads: ThreadListItem[];
  archivedThreads: ThreadListItem[];
  mode: ThreadListMode;
  filter: ThreadListFilter;
  query: string;
  onQueryChange(query: string): void;
  onOpenSearch(): void;
  searchContent: ReactNode;
  onModeChange(mode: ThreadListMode): void;
  onFilterChange(filter: ThreadListFilter): void;
  onLoadMore(): void;
  initialOffset: number;
  onOffsetChange(offset: number): void;
  onSelectThread(id: string): void;
  onPreloadThread(id: string): (() => void) | undefined;
  onSelectServer(scope: ServerScope): void;
  onNewThread(): void;
  onSettings(): void;
  onTogglePin(thread: ThreadListItem): Promise<void>;
  onArchive(thread: ThreadListItem): Promise<void>;
  onUnarchive(thread: ThreadListItem): Promise<void>;
  onMarkRead(thread: ThreadListItem): Promise<void>;
  onRefreshAccountRateLimits?(): Promise<unknown>;
} & SidebarProjectsNavigation;
