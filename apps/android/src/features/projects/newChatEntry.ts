import type { ThreadListServer } from "../connections/connectionPresentation";

/** Resolves the initial draft server from local context without changing the list filter. */
export function newChatDefaultServer(
  preferredConnectionId: string | null,
  servers: readonly ThreadListServer[],
): string | null {
  return (
    (
      servers.find((server) => server.id === preferredConnectionId) ??
      servers.find((server) => server.status === "live" || server.status === "syncing") ??
      servers[0]
    )?.id ?? null
  );
}
