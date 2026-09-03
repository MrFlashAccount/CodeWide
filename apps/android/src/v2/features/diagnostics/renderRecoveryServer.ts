import type { SavedServerId } from "../../domain/ids";
import type { SavedServer } from "../../domain/savedServer";

/** Chooses a live-capable server without turning aggregate selection into a hidden singleton. */
export function selectRecoveryServer(
  servers: readonly SavedServer[],
  preferredId: SavedServerId | null,
): SavedServer | null {
  if (preferredId !== null) {
    return servers.find((server) => server.id === preferredId && server.enabled) ?? null;
  }
  const enabled = servers.filter((server) => server.enabled);
  return enabled.length === 1 ? (enabled[0] ?? null) : null;
}
