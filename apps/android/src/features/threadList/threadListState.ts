import { useState } from "react";
import { ScrollOffsetMemory } from "./scrollOffsetMemory";
import type { ThreadListFilter } from "./threadListFilters";
import { THREAD_LIST_PAGE_SIZE, type ThreadListMode } from "./threadListModel";

/** Paging, filtering and offset memory share the mounted list lifetime. */
export function useThreadListState() {
  const [mobileThreadQuery, setMobileThreadQuery] = useState("");

  const [mobileThreadOffset] = useState(() => new ScrollOffsetMemory());

  const [threadListMode, setThreadListMode] = useState<ThreadListMode>("active");

  const [threadListFilter, setThreadListFilter] = useState<ThreadListFilter>("all");

  const [threadListLimit, setThreadListLimit] = useState(THREAD_LIST_PAGE_SIZE);
  return {
    mobileThreadQuery,
    setMobileThreadQuery,
    mobileThreadOffset,
    threadListMode,
    setThreadListMode,
    threadListFilter,
    setThreadListFilter,
    threadListLimit,
    setThreadListLimit,
  };
}

/** Project catalogs retain separate paging and filtering state. */
export function useProjectListState() {
  const [projectListMode, setProjectListMode] = useState<ThreadListMode>("active");
  const [projectListFilter, setProjectListFilter] = useState<ThreadListFilter>("all");
  const [projectListLimits, setProjectListLimits] = useState<Readonly<Record<string, number>>>({});
  return {
    projectListMode,
    setProjectListMode,
    projectListFilter,
    setProjectListFilter,
    projectListLimits,
    setProjectListLimits,
  };
}
