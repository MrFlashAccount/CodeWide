/** V1 connectionPresentation owner, extracted without changing interaction or resource lifetime. */
import { Platform } from "react-native";
import type { StoredConnection } from "../../data/connection-profile-types";
import { colors } from "../../theme";

export type ServerStatus =
  | "live"
  | "syncing"
  | "offline"
  | "connecting"
  | "degraded"
  | "authRequired";

export type ThreadListServer = {
  emoji: string;
  endpoint?: string;
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
      emoji: server.emoji,
      id: server.id,
      name: server.displayName,
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
          current.emoji === server.emoji &&
          current.status === server.status
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

export function connectionActivity(status: ServerStatus): ConnectionActivity | null {
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

export function connectionStateLabel(status: ServerStatus, enabled = true): string {
  if (!enabled) {
    return "Disabled";
  }
  if (status === "live") {
    return "Live";
  }
  if (status === "syncing") {
    return "Updating…";
  }
  if (status === "connecting") {
    return "Connecting…";
  }
  if (status === "authRequired") {
    return "Access required";
  }
  if (status === "degraded") {
    return "Connection error";
  }
  return "Offline";
}

export function connectionStateColor(status: ServerStatus): string {
  if (status === "live") {
    return colors.green;
  }
  if (status === "syncing" || status === "connecting") {
    return colors.amber;
  }
  if (status === "offline") {
    return colors.textDim;
  }
  return colors.red;
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

export function serverGlyph(server: Pick<ThreadListServer, "emoji" | "name">): string {
  if (Platform.OS !== "web") {
    return server.emoji;
  }
  const initial = server.name.trim().slice(0, 1).toLocaleUpperCase();
  return initial === "" ? "C" : initial;
}
