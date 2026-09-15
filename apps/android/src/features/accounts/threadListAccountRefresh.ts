import type { GetAccountRateLimitsResponse } from "@codewide/codex-protocol/v0.147.0/v2";
import { useEvent } from "../../react/useEvent";
import type { ThreadListServer } from "../connections/connectionPresentation";
import { ALL_SERVERS_ID } from "../navigation/serverSelection";
/** Refresh only the currently scoped account projections. */
export function useThreadListAccountRefresh(
  servers: ThreadListServer[],
  activeServerId: string,
  refreshAccountRateLimits: (connectionId: string) => Promise<GetAccountRateLimitsResponse>,
) {
  const refreshThreadListAccountRateLimits = useEvent(async (): Promise<void> => {
    const refreshableServers =
      activeServerId === ALL_SERVERS_ID
        ? servers.filter((server) => server.status === "live" || server.status === "syncing")
        : servers.filter((server) => server.id === activeServerId);
    await Promise.all(refreshableServers.map((server) => refreshAccountRateLimits(server.id)));
  });
  return { refreshThreadListAccountRateLimits };
}
