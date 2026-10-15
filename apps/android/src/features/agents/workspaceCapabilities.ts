import type { BackgroundTaskOutputPage } from "../../data/backgroundTaskOutput";

/** Qualified agents operations; transport and persisted state stay with their existing lower owners. */
export type AgentsWorkspaceCapabilities = {
  /** One page of a thread's background task output; rejects when the connection is offline. */
  readBackgroundTask: (
    connectionId: string,
    request: { readonly offset: number; readonly taskId: string; readonly threadId: string },
  ) => Promise<BackgroundTaskOutputPage>;
  refreshSubagents: (connectionId: string, rootThreadId: string, force?: boolean) => Promise<void>;
};
