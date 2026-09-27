import type { RemoteConnectionState } from "@codewide/sync-client";
import type { ConnectionPath } from "./connectionPath";

/** Event-driven presentation only; never admits RPC or schedules history/transport work. */
export type ConnectionHealthStatus =
  | "online"
  | "reconnecting"
  | "noConnection"
  | "serviceUnavailable"
  | "authRequired"
  | "connectionError"
  | "disabled";

type HealthInput = {
  readonly enabled: boolean;
  readonly path: ConnectionPath | null;
  readonly rpcAvailable: boolean;
  readonly state: RemoteConnectionState;
};

/** Working RPC outweighs Android validation; absence of a route is shown immediately. */
export function connectionHealth(input: HealthInput): ConnectionHealthStatus {
  if (!input.enabled) {
    return "disabled";
  }
  if (input.state === "authRequired") {
    return "authRequired";
  }
  if (input.rpcAvailable) {
    // Keep real projection/delivery failures visible, without inventing a
    // separate user-facing history state or claiming the network is offline.
    return input.state === "degraded" ? "connectionError" : "online";
  }
  return disconnectedHealth(input.path);
}

function disconnectedHealth(path: ConnectionPath | null): ConnectionHealthStatus {
  if (path === null) {
    return "reconnecting";
  }
  if (path.network.status === "noDefaultNetwork" || path.network.status === "blocked") {
    return "noConnection";
  }
  return availableRouteHealth(path);
}

function availableRouteHealth(path: ConnectionPath): ConnectionHealthStatus {
  if (path.link.status === "connected") {
    return path.link.appServer === "reconnecting" ? "serviceUnavailable" : "reconnecting";
  }
  if (path.network.status === "unvalidated" || path.network.status === "captivePortal") {
    return "noConnection";
  }
  // Android validation alone is not evidence of a service failure. Backoff is.
  return path.link.status === "backoff" ? "serviceUnavailable" : "reconnecting";
}
