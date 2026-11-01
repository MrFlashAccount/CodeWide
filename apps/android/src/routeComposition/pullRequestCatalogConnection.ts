import type { ThreadListServer } from "../features/connections/connectionPresentation";
import type { ServerScope } from "../services/servers/serverScope";

/**
 * Companion whose forge accounts the Pull requests tab shows: the selected
 * server, else the first live one, else the first saved one.
 */
export function pullRequestCatalogConnection(
  scope: ServerScope,
  servers: readonly ThreadListServer[],
): string | null {
  if (scope.kind === "connection") {
    return scope.connectionId;
  }
  return (
    servers.find((server) => server.status === "live" || server.status === "syncing")?.id ??
    servers[0]?.id ??
    null
  );
}
