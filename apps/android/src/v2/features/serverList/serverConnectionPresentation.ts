import type {
  ServerConnectionState,
  ServerConnectionStatus,
} from "../../application/resources/serverConnectionStatusesResource";
import type { SavedServerId } from "../../domain/ids";
import type { SavedServer } from "../../domain/savedServer";

export interface PresentedServerConnection {
  detail: string;
  emoji: string;
  id: SavedServerId;
  label: string;
}

export function serverConnectionRows(
  servers: readonly SavedServer[],
  statuses: ReadonlyMap<SavedServerId, ServerConnectionStatus>,
): PresentedServerConnection[] {
  return servers.map((server) => ({
    detail: serverConnectionLabel(statuses.get(server.id), server.enabled),
    emoji: server.emoji,
    id: server.id,
    label: server.displayName,
  }));
}

export function serverConnectionLabel(
  status: ServerConnectionStatus | undefined,
  enabled: boolean,
): string {
  if (!enabled || status?.state === "disabled") return "Disabled";
  if (status === undefined || status.state === "connecting") return "Connecting";
  if (status.state === "connected") return "Live";
  if (status.state === "updating") return "Updating";
  if (status.state === "accessRequired") return "Access required";
  if (status.state === "error") return "Connection error";
  return "Offline";
}

export function aggregateConnectionState(
  servers: readonly SavedServer[],
  statuses: ReadonlyMap<SavedServerId, ServerConnectionStatus>,
): "error" | "initializing" | "live" | "offline" | "reinitializing" {
  const enabled = servers.filter((server) => server.enabled);
  if (enabled.length === 0) return "offline";
  const states = enabled.map(
    (server): ServerConnectionState => statuses.get(server.id)?.state ?? "connecting",
  );
  if (states.every((state) => state === "connected")) return "live";
  if (states.some((state) => state === "updating")) return "reinitializing";
  if (states.some((state) => state === "connecting" || state === "connected")) {
    return "initializing";
  }
  if (states.some((state) => state === "error" || state === "accessRequired")) return "error";
  return "offline";
}

export function aggregateConnectionLabel(
  servers: readonly SavedServer[],
  statuses: ReadonlyMap<SavedServerId, ServerConnectionStatus>,
): string {
  const enabled = servers.filter((server) => server.enabled);
  if (enabled.length === 0) return "No enabled servers";
  const live = enabled.filter((server) => statuses.get(server.id)?.state === "connected").length;
  if (live === enabled.length) return `${live} ${live === 1 ? "server" : "servers"} live`;
  return `${live} of ${enabled.length} live`;
}
