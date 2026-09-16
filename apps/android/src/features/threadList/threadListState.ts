import { useState } from "react";
import { useConstant } from "../../react/useConstant";
import { ScrollOffsetMemory } from "./scrollOffsetMemory";
import type { ThreadListFilter } from "./threadListFilters";
import { THREAD_LIST_PAGE_SIZE, type ThreadListMode } from "./threadListModel";

/** Paging, filtering and offset memory share the mounted list lifetime. */
export function useThreadListState() {
  const [mobileThreadQuery, setMobileThreadQuery] = useState("");

  const mobileThreadOffset = useConstant(() => new ScrollOffsetMemory());

  const [threadListMode, setThreadListMode] = useState<ThreadListMode>("active");

  const [threadListFilter, setThreadListFilter] = useState<ThreadListFilter>("all");

  const [threadListLimit, setThreadListLimit] = useState(THREAD_LIST_PAGE_SIZE);
  return {
    mobileThreadOffset,
    mobileThreadQuery,
    setMobileThreadQuery,
    setThreadListFilter,
    setThreadListLimit,
    setThreadListMode,
    threadListFilter,
    threadListLimit,
    threadListMode,
  };
}

/** Project catalogs retain separate paging and filtering state. */
export function useProjectListState() {
  const [projectListMode, setProjectListMode] = useState<ThreadListMode>("active");
  const [projectListFilter, setProjectListFilter] = useState<ThreadListFilter>("all");
  const [projectListLimits, setProjectListLimits] = useState<Readonly<Record<string, number>>>({});
  return {
    projectListFilter,
    projectListLimits,
    projectListMode,
    setProjectListFilter,
    setProjectListLimits,
    setProjectListMode,
  };
}
