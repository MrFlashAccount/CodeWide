import { useSelector } from "@legendapp/state/react";

import type { StoredConnection } from "../../data/connection-profile-types";
import type { HostUpdateResource } from "./hostUpdateResourceState";
import type { HostUpdateView } from "./hostUpdateSettingsContract";

/**
 * Declares per-connection demand during render. The stable Connections model,
 * not this hook, owns requests, deduplication and reconnect reconciliation.
 */
export function useHostUpdateProjection(
  connections: readonly StoredConnection[],
  resource: HostUpdateResource,
): Readonly<Record<string, HostUpdateView>> {
  for (const connection of connections) {
    resource.observe(connection.id, canReachCompanion(connection));
  }
  return useSelector(() => resource.snapshot$.byConnection.get());
}

function canReachCompanion(connection: StoredConnection): boolean {
  if (!connection.enabled) {
    return false;
  }
  if (connection.health !== undefined) {
    return connection.health === "online";
  }
  return connection.state === "live" || connection.state === "syncing";
}
