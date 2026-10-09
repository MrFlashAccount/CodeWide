import type { StoredConnection } from "../../data/connection-profile-types";
import type { ThreadListServer } from "../connections/connectionPresentation";
import type { ProjectPickerServer } from "./projectPickerContract";

/** Retains saved server identity while restricting native folder reads to live connections. */
export function projectPickerServers(
  servers: readonly ThreadListServer[],
  connections: readonly StoredConnection[],
  native: boolean,
): readonly ProjectPickerServer[] {
  return servers.map((server) => ({
    available:
      !native ||
      connections.some(
        (connection) =>
          connection.id === server.id &&
          connection.enabled &&
          (connection.state === "live" || connection.state === "syncing"),
      ),
    iconId: server.iconId,
    id: server.id,
    name: server.name,
  }));
}
