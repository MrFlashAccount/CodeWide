import type { GetAccountRateLimitsResponse } from "@codewide/codex-protocol/v0.155.1/v2";
import { useEvent } from "../../react/useEvent";
import { serverScopeIncludes, type ServerScope } from "../../services/servers/serverScope";
import type { ThreadListServer } from "../connections/connectionPresentation";
/** Refresh only the currently scoped account projections. */
export function useThreadListAccountRefresh(
  servers: ThreadListServer[],
  serverScope: ServerScope,
  refreshAccountRateLimits: (
    connectionId: string,
    force?: boolean,
  ) => Promise<GetAccountRateLimitsResponse>,
) {
  const refreshThreadListAccountRateLimits = useEvent(async (): Promise<void> => {
    const refreshableServers = servers.filter(
      (server) =>
        serverScopeIncludes(serverScope, server.id) &&
        (serverScope.kind === "connection" ||
          server.status === "live" ||
          server.status === "syncing"),
    );
    await Promise.all(
      refreshableServers.map(async (server) => refreshAccountRateLimits(server.id, true)),
    );
  });
  return { refreshThreadListAccountRateLimits };
}
