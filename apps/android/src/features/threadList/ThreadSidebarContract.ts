import type { ReactNode } from "react";
import type { ServerScope } from "../../services/servers/serverScope";
import type { ThreadListServer } from "../connections/connectionPresentation";
import type { ThreadListFilter } from "./threadListFilters";
import type { SidebarProjectsNavigation, ThreadListMode } from "./threadListModel";
import type { ThreadListItem } from "./threadListTypes";

/** Thread-list state, layout, and actions used by the desktop sidebar. */
export type ThreadSidebarProps = {
  width: number;
  initialOffset: number;
  onOffsetChange(offset: number): void;
  servers: ThreadListServer[];
  serverScope: ServerScope;
  threads: ThreadListItem[];
  archivedThreads: ThreadListItem[];
  mode: ThreadListMode;
  filter: ThreadListFilter;
  selectedThreadKey: string | null;
  onOpenSearch(): void;
  searchContent: ReactNode;
  onModeChange(mode: ThreadListMode): void;
  onFilterChange(filter: ThreadListFilter): void;
  onLoadMore(): void;
  onSelect(id: string): void;
  onPreload(id: string): (() => void) | undefined;
  onSelectServer(scope: ServerScope): void;
  onSettings(): void;
  onNewThread(): void;
  onTogglePin(thread: ThreadListItem): Promise<void>;
  onArchive(thread: ThreadListItem): Promise<void>;
  onUnarchive(thread: ThreadListItem): Promise<void>;
  onMarkRead(thread: ThreadListItem): Promise<void>;
  onRefreshAccountRateLimits?(): Promise<unknown>;
} & SidebarProjectsNavigation;
