import { queryOptions, type QueryClient } from "@tanstack/react-query";

import { appLogger } from "../observability/logger";
import { backgroundTaskInvalidationBus } from "./backgroundTaskInvalidationBus";
import {
  listRunningBackgroundTasks,
  runningBackgroundTasksKey,
  type RunningBackgroundTask,
} from "./runningBackgroundTasks";

/** A shown list re-reads at this interval in case a change event was missed. */
const RESYNC_INTERVAL_MS = 60_000;
const STALE_AFTER_MS = 15_000;

/** The Companion call a resource reads through, for one connection. */
type Call = (connectionId: string, method: string, params: unknown) => Promise<unknown>;

/** The TanStack Query options of one thread's running background commands. */
export type RunningBackgroundTasksQuery = ReturnType<typeof runningTasksQuery>;

function runningTasksQuery(call: Call, connectionId: string, threadId: string) {
  return queryOptions<readonly RunningBackgroundTask[]>({
    queryFn: async () =>
      listRunningBackgroundTasks(
        async (method, params) => call(connectionId, method, params),
        threadId,
      ),
    queryKey: runningBackgroundTasksKey(connectionId, threadId),
    refetchInterval: RESYNC_INTERVAL_MS,
    refetchIntervalInBackground: false,
    retry: false,
    staleTime: STALE_AFTER_MS,
  });
}

/**
 * Threads' running background commands as TanStack queries. Every event that
 * may change a thread's list (`backgroundTaskInvalidationBus`) invalidates
 * that thread's query; the query itself only reads.
 */
export function createRunningBackgroundTaskResource(authority: {
  readonly call: Call;
  readonly queryClient: QueryClient;
}): { readonly query: (connectionId: string, threadId: string) => RunningBackgroundTasksQuery } {
  backgroundTaskInvalidationBus.subscribe((connectionId, threadId) => {
    authority.queryClient
      .invalidateQueries({
        exact: true,
        queryKey: runningBackgroundTasksKey(connectionId, threadId),
      })
      .catch((error: unknown) => {
        appLogger.warnCaught({
          error,
          event: "background_tasks.invalidate_failed",
          fields: { connectionId, threadId },
        });
      });
  });
  return {
    query: (connectionId, threadId) => runningTasksQuery(authority.call, connectionId, threadId),
  };
}
