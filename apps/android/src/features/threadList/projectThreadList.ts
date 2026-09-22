import type { Dispatch, SetStateAction } from "react";
import { useEvent } from "../../react/useEvent";
import type { SidebarProject } from "../projects/sidebarProjects";
import type { ThreadListFilter } from "./threadListFilters";
import { effectiveThreadListFilter } from "./threadListFilters";
import type { ThreadListMode } from "./threadListModel";
import { THREAD_LIST_PAGE_SIZE } from "./threadListModel";
/** Identifies one server-qualified project page independently of its presentation. */
export function projectThreadListKey(project: SidebarProject, mode: ThreadListMode): string {
  return `project:${project.key}:${mode}`;
}

/** Project pages keep independent limits and filters while changing the visible scope. */
export function useProjectThreadList(
  serverScopeKey: string,
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

  const changeSidebarMode = useEvent((mode: ThreadListMode) => {
    (sidebarProject === null ? setThreadListMode : setProjectListMode)(mode);
  });

  const sidebarFilter = effectiveThreadListFilter(
    sidebarMode,
    sidebarProject === null ? threadListFilter : projectListFilter,
  );

  const changeSidebarFilter = useEvent((filter: ThreadListFilter) => {
    (sidebarProject === null ? setThreadListFilter : setProjectListFilter)(filter);
  });

  const sidebarScopeKey =
    sidebarProject === null
      ? `${serverScopeKey}:${sidebarMode}`
      : projectThreadListKey(sidebarProject, sidebarMode);

  const projectLimitKey =
    sidebarProject === null ? "" : projectThreadListKey(sidebarProject, projectListMode);

  const projectLimit = projectListLimits[projectLimitKey] ?? THREAD_LIST_PAGE_SIZE;

  const loadMoreProjectThreads = useEvent((limit: number) => {
    setProjectListLimits((limits) => ({
      ...limits,
      [projectLimitKey]: Math.max(limits[projectLimitKey] ?? THREAD_LIST_PAGE_SIZE, limit),
    }));
  });
  return {
    changeSidebarFilter,
    changeSidebarMode,
    loadMoreProjectThreads,
    projectLimit,
    sidebarFilter,
    sidebarMode,
    sidebarScopeKey,
  };
}
