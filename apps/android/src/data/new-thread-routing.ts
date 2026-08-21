export type NewThreadRoute =
  | { type: "connect-server" }
  | { type: "choose-server" }
  | { type: "create"; serverId: string };

export function resolveNewThreadRoute({
  activeServerId,
  allServersId,
  serverIds,
}: {
  activeServerId: string;
  allServersId: string;
  serverIds: readonly string[];
}): NewThreadRoute {
  if (serverIds.length === 0) return { type: "connect-server" };
  if (activeServerId !== "" && activeServerId !== allServersId && serverIds.includes(activeServerId)) {
    return { type: "create", serverId: activeServerId };
  }
  if (serverIds.length === 1) return { type: "create", serverId: serverIds[0]! };
  return { type: "choose-server" };
}
