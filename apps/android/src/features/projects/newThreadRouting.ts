import type { ServerScope } from "../../services/servers/serverScope";

export type NewThreadRoute =
  | { type: "connect-server" }
  | { type: "choose-server" }
  | { serverId: string; type: "create" };

export function resolveNewThreadRoute({
  serverIds,
  serverScope,
}: {
  serverIds: readonly string[];
  serverScope: ServerScope;
}): NewThreadRoute {
  if (serverIds.length === 0) {
    return { type: "connect-server" };
  }
  if (serverScope.kind === "connection" && serverIds.includes(serverScope.connectionId)) {
    return { serverId: serverScope.connectionId, type: "create" };
  }
  if (serverIds.length === 1) {
    return { type: "create", serverId: serverIds[0]! };
  }
  return { type: "choose-server" };
}
