import type { Dispatch, SetStateAction } from "react";
import { useEvent } from "../../react/useEvent";
import type { SidebarProject } from "../projects/sidebarProjects";
import type { ThreadListFilter } from "./threadListFilters";
import { effectiveThreadListFilter } from "./threadListFilters";
import type { ThreadListMode } from "./threadListModel";
import { THREAD_LIST_PAGE_SIZE } from "./threadListModel";
/** Project pages keep independent limits and filters while changing the visible scope. */
export function useProjectThreadList(
  activeServerId: string,
  sidebarProject: SidebarProject | null,
  threadListMode: ThreadListMode,
  setThreadListMode: (mode: ThreadListMode) => void,
  threadListFilter: ThreadListFilter,
  setThreadListFilter: (filter: ThreadListFilter) => void,
  projectListMode: ThreadListMode,
  setProjectListMode: (mode: ThreadListMode) => void,
  projectListFilter: ThreadListFilter,
  setProjectListFilter: (filter: ThreadListFilter) => void,
  projectListLimits: Readonly<Record<string, number>>,
  setProjectListLimits: Dispatch<SetStateAction<Readonly<Record<string, number>>>>,
) {
  const sidebarMode = sidebarProject === null ? threadListMode : projectListMode;

  const changeSidebarMode = useEvent((mode: ThreadListMode) =>
    (sidebarProject === null ? setThreadListMode : setProjectListMode)(mode),
  );

  const sidebarFilter = effectiveThreadListFilter(
    sidebarMode,
    sidebarProject === null ? threadListFilter : projectListFilter,
  );

  const changeSidebarFilter = useEvent((filter: ThreadListFilter) =>
    (sidebarProject === null ? setThreadListFilter : setProjectListFilter)(filter),
  );

  const sidebarScopeKey = `${activeServerId}:${sidebarMode}${sidebarProject === null ? "" : `:${sidebarProject.key}`}`;

  const projectLimitKey = `${sidebarProject?.key ?? ""}:${projectListMode}`;

  const projectLimit = projectListLimits[projectLimitKey] ?? THREAD_LIST_PAGE_SIZE;

  const loadMoreProjectThreads = useEvent(() =>
    setProjectListLimits((limits) => ({
      ...limits,
      [projectLimitKey]: (limits[projectLimitKey] ?? THREAD_LIST_PAGE_SIZE) + THREAD_LIST_PAGE_SIZE,
    })),
  );
  return {
    sidebarMode,
    changeSidebarMode,
    sidebarFilter,
    changeSidebarFilter,
    sidebarScopeKey,
    projectLimit,
    loadMoreProjectThreads,
  };
}
