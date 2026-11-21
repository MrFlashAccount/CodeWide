import { skipToken, useQuery } from "@tanstack/react-query";
import { useContext } from "react";
import type { RunningBackgroundTask } from "../../../data/runningBackgroundTasks";
import { RunningBackgroundTasksContext } from "../turns/turnContexts";
import { placeRunningTasks, type TimelineTaskPlacement } from "./runningTaskPlacement";
import type { TimelineRow } from "./timelineRows";

const NO_RUNNING_TASKS: readonly RunningBackgroundTask[] = [];

/** A thread without a list keeps its history and observes no live query. */
export function useRunningTaskPlacement(
  rows: TimelineRow[],
  atLatest: boolean,
): TimelineTaskPlacement {
  const query = useContext(RunningBackgroundTasksContext);
  const { data } = useQuery(
    query ?? { queryFn: skipToken, queryKey: ["thread/backgroundTasks", "unavailable"] },
  );
  return placeRunningTasks(rows, data ?? NO_RUNNING_TASKS, atLatest);
}
