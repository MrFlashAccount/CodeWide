/** V1 connectionPresentation owner, extracted without changing interaction or resource lifetime. */
import type { StoredConnection } from "../../data/connection-profile-types";
import type { ConnectionHealthStatus } from "../../data/connectionHealth";
import type { ServerIconId } from "../../data/serverIcons";
import { colors } from "../../theme";

export type ServerStatus =
  | "live"
  | "syncing"
  | "offline"
  | "connecting"
  | "degraded"
  | "authRequired";

export type ThreadListServer = {
  endpoint?: string;
  health?: ConnectionHealthStatus | undefined;
  iconId: ServerIconId;
  id: string;
  name: string;
  status: ServerStatus;
  tlsPinSha256?: string;
  token?: string;
};

export class ThreadServerProjection {
  #value: ThreadListServer[] = [];

  project(connections: readonly StoredConnection[]): ThreadListServer[] {
    const next = connections.map((server) => ({
      iconId: server.iconId,
      id: server.id,
      name: server.displayName,
      ...(server.health === undefined ? {} : { health: server.health }),
      status: server.enabled ? server.state : ("offline" as const),
    }));
    if (
      next.length === this.#value.length &&
      next.every((server, index) => {
        const current = this.#value[index];
        return (
          current !== undefined &&
          current.id === server.id &&
          current.name === server.name &&
          current.iconId === server.iconId &&
          current.status === server.status &&
          current.health === server.health
        );
      })
    ) {
      return this.#value;
    }
    this.#value = next;
    return this.#value;
  }
}

export type ConnectionActivity = "connecting" | "updating";

export function connectionActivity(
  status: ServerStatus,
  health?: ConnectionHealthStatus,
): ConnectionActivity | null {
  if (health !== undefined) {
    if (health === "reconnecting") {
      return "connecting";
    }
    return null;
  }
  if (status === "connecting") {
    return "connecting";
  }
  if (status === "syncing") {
    return "updating";
  }
  return null;
}

export function connectionActivityColor(activity: ConnectionActivity): string {
  return activity === "connecting" ? colors.textDim : colors.amber;
}

const healthLabels: Record<ConnectionHealthStatus, string> = {
  authRequired: "Access required",
  connectionError: "Connection error",
  disabled: "Disabled",
  noConnection: "Нет подключения",
  online: "Live",
  reconnecting: "Reconnecting…",
  serviceUnavailable: "Server unavailable",
};

const legacyLabels: Record<ServerStatus, string> = {
  authRequired: "Access required",
  connecting: "Connecting…",
  degraded: "Connection error",
  live: "Live",
  offline: "Offline",
  syncing: "Updating…",
};
const legacyColors: Record<ServerStatus, string> = {
  authRequired: colors.red,
  connecting: colors.amber,
  degraded: colors.red,
  live: colors.green,
  offline: colors.textDim,
  syncing: colors.amber,
};
const healthColors: Partial<Record<ConnectionHealthStatus, string>> = {
  authRequired: colors.red,
  connectionError: colors.red,
  disabled: colors.textDim,
  noConnection: colors.textDim,
  online: colors.green,
};

export function connectionStateLabel(
  status: ServerStatus,
  enabled = true,
  health?: ConnectionHealthStatus,
): string {
  if (!enabled) {
    return "Disabled";
  }
  return health === undefined ? legacyLabels[status] : healthLabels[health];
}

export function connectionStateColor(
  status: ServerStatus,
  health?: ConnectionHealthStatus,
): string {
  return health === undefined ? legacyColors[status] : (healthColors[health] ?? colors.amber);
}

// WHY: This presenter owns the priority order of mutually competing connection diagnostics;
// changing branch order would show a lower-priority status instead of the actionable failure.
// oxlint-disable-next-line eslint/complexity
export function connectionDiagnosticSummary(diagnostic: string): string {
  if (diagnostic.includes("session_expired") || diagnostic.startsWith("4003:")) {
    return "Session expired. Refreshing credentials and reconnecting.";
  }
  if (diagnostic === "native_frame_journal_overflow") {
    return "Incoming update buffer overflowed. A fresh sync is required.";
  }
  if (diagnostic.includes("Pairing or access grant required")) {
    return "This device needs to be paired again.";
  }
  if (diagnostic === "IOException") {
    return "The server could not be reached.";
  }
  const firstLine = diagnostic.split("\n", 1)[0]?.trim();
  return firstLine === undefined || firstLine === "" ? "Unknown connection error" : firstLine;
}

export function connectionDiagnosticTime(timestamp: number | null): string | null {
  if (timestamp === null) {
    return null;
  }
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
