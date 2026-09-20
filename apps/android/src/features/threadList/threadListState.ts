import { startTransition, useState } from "react";
import { useConstant } from "../../react/useConstant";
import { useEvent } from "../../react/useEvent";
import { ScrollOffsetMemory } from "./scrollOffsetMemory";
import type { ThreadListFilter } from "./threadListFilters";
import { THREAD_LIST_PAGE_SIZE, type ThreadListMode } from "./threadListModel";

/** Paging, filtering and offset memory share the mounted list lifetime. */
export function useThreadListState() {
  const [mobileThreadQuery, setMobileThreadQuery] = useState("");

  const mobileThreadOffset = useConstant(() => new ScrollOffsetMemory());

  const [threadListMode, setThreadListMode] = useState<ThreadListMode>("active");

  const changeThreadListMode = useEvent((mode: ThreadListMode): void => {
    startTransition(() => {
      setThreadListMode(mode);
    });
  });

  const [threadListFilter, setThreadListFilter] = useState<ThreadListFilter>("all");

  const [threadListLimit, setThreadListLimit] = useState(THREAD_LIST_PAGE_SIZE);
  return {
    mobileThreadOffset,
    mobileThreadQuery,
    setMobileThreadQuery,
    setThreadListFilter,
    setThreadListLimit,
    setThreadListMode: changeThreadListMode,
    threadListFilter,
    threadListLimit,
    threadListMode,
  };
}

/** Project catalogs retain separate paging and filtering state. */
export function useProjectListState() {
  const [projectListMode, setProjectListMode] = useState<ThreadListMode>("active");
  const changeProjectListMode = useEvent((mode: ThreadListMode): void => {
    startTransition(() => {
      setProjectListMode(mode);
    });
  });
  const [projectListFilter, setProjectListFilter] = useState<ThreadListFilter>("all");
  const [projectListLimits, setProjectListLimits] = useState<Readonly<Record<string, number>>>({});
  return {
    projectListFilter,
    projectListLimits,
    projectListMode,
    setProjectListFilter,
    setProjectListLimits,
    setProjectListMode: changeProjectListMode,
  };
}
