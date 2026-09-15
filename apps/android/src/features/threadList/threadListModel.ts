import { useEvent } from "../../react/useEvent";
import { useState } from "react";
import type { ThreadListSources } from "./threadListSources";
import { useThreadSummaryView } from "../../data/use-thread-summary-view";
import { threadListLayout } from "../../ui/thread-list-layout";
import { threadSelectionKey } from "../navigation/threadSelection";
import type { SidebarProject } from "../projects/sidebarProjects";
import { sidebarListState, type SidebarListState } from "./SidebarListFeedback";
import type { SidebarRow } from "./sidebarRows";
import { ThreadListProjection } from "./summaryProjection";
import { ThreadListItemProjection, deduplicateThreadSummaries } from "./threadListProjection";
import type { ThreadListItem } from "./threadListTypes";

export const THREAD_LIST_PAGE_SIZE = 36;

export type ThreadListRow = SidebarRow<ThreadListItem>;

export type SidebarProjectsNavigation = {
  catalogState: SidebarListState;
  remote: ThreadListSources;
  projectLimit: number;
  onLoadMoreProject(): void;
  project: SidebarProject | null;
  projects: readonly SidebarProject[];
  onOpenProject(project: SidebarProject): void;
  onBackToProjects(): void;
  onManageProjects(): void;
};

export function useProjectSidebarThreads(
  remote: ThreadListSources,
  project: SidebarProject | null,
  mode: ThreadListMode,
  limit: number,
  onLoadMore: () => void,
) {
  const scopeKey = `${project?.key ?? ""}:${mode}`;
  const [projection] = useState(() => new ThreadListProjection());
  const [items] = useState(() => new ThreadListItemProjection());
  const view = useThreadSummaryView(
    remote.threadSummaryDatabase,
    project === null
      ? null
      : {
          viewId: `sidebar-project:${scopeKey}`,
          connectionId: project.connectionId,
          projectCwd: project.path,
          recentLimit: mode === "active" ? limit : 0,
          archivedLimit: mode === "archived" ? limit : 0,
          selectedConnectionId: null,
          selectedThreadId: null,
          subagentConnectionId: null,
          subagentLimit: 0,
        },
  );
  const summaries =
    mode === "archived"
      ? (view?.archived ?? [])
      : deduplicateThreadSummaries([...(view?.pinned ?? []), ...(view?.recent ?? [])]);
  const threads = items.project(projection.project(summaries, remote.pendingRequests));
  const loadMore = useEvent(() => {
    if (summaries.length < limit) return;
    onLoadMore();
  });
  return { threads, loadMore, state: sidebarListState(view?.phase, view?.error ?? null, false) };
}

export function sidebarRowKey(row: ThreadListRow): string {
  if (row.kind === "header") return `header-${row.title}`;
  if (row.kind === "project") return `project-${row.project.key}`;
  return threadSelectionKey(row.thread);
}

export const THREAD_LIST_ROW_CONTENT_HEIGHT = threadListLayout.rowContentHeight;

export const THREAD_LIST_ROW_VERTICAL_MARGIN = threadListLayout.rowVerticalMargin;

export const THREAD_LIST_ROW_HEIGHT =
  THREAD_LIST_ROW_CONTENT_HEIGHT + THREAD_LIST_ROW_VERTICAL_MARGIN * 2;

export const THREAD_LIST_SECTION_HEIGHT = threadListLayout.sectionHeight;

export function threadListRowHeight(row: ThreadListRow): number {
  if (row.kind === "project") return threadListLayout.projectRowHeight;
  return row.kind === "header" ? THREAD_LIST_SECTION_HEIGHT : THREAD_LIST_ROW_HEIGHT;
}

export type ThreadListMode = "active" | "archived";

export function threadListRowsEqual(previous: ThreadListRow, next: ThreadListRow): boolean {
  if (previous.kind !== next.kind) return false;
  if (previous.kind === "header" && next.kind === "header") return previous.title === next.title;
  if (previous.kind === "project" && next.kind === "project")
    return (
      previous.project.key === next.project.key &&
      previous.project.name === next.project.name &&
      previous.project.serverLabel === next.project.serverLabel &&
      previous.project.unread === next.project.unread
    );
  if (previous.kind !== "thread" || next.kind !== "thread") return false;
  const left = previous.thread;
  const right = next.thread;
  return (
    left === right ||
    (left.id === right.id &&
      left.serverId === right.serverId &&
      left.title === right.title &&
      left.preview === right.preview &&
      left.time === right.time &&
      left.timestamp === right.timestamp &&
      left.pinned === right.pinned &&
      left.archived === right.archived &&
      left.unread === right.unread &&
      left.state === right.state)
  );
}
