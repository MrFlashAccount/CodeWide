/**
 * The process-lifetime read model of threads' running background commands,
 * bound to the V1 session authority and the shared process query client.
 */
import { forgeResources } from "./forgeRuntime";
import { createRunningBackgroundTaskResource } from "./runningBackgroundTaskResource";
import { rpcAfterAttach, workspaceRuntime } from "./workspace-runtime";

/** Running background commands of the shown threads. */
export const runningBackgroundTaskResource = createRunningBackgroundTaskResource({
  call: async (connectionId, method, params) => {
    const session = workspaceRuntime.supervisor?.session(connectionId);
    if (session === undefined) {
      throw new Error("The server is not connected");
    }
    return rpcAfterAttach<unknown>(session, method, params);
  },
  queryClient: forgeResources.queryClient,
});
