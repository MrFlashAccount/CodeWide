import type { StoredConnection } from "../../data/connection-profile-types";
import { useState } from "react";
import { useEvent } from "../../react/useEvent";

/** V1 thread-list scope, which is filtering state rather than a destination. */
export type ServerScope =
  | { readonly kind: "all" }
  | { readonly connectionId: string; readonly kind: "connection" };

export const ALL_SERVER_SCOPE: ServerScope = { kind: "all" };

export type ServerScopeBinding = {
  readonly consumeDesktopDefaultThread: () => void;
  readonly desktopDefaultThreadEnabled: boolean;
  readonly scope: ServerScope;
  readonly select: (next: ServerScope) => void;
};

/** Keeps a requested V1 list scope valid as saved connections change. */
export function normalizeServerScope(
  requested: ServerScope,
  connections: readonly StoredConnection[],
): ServerScope {
  if (connections.length <= 1 || requested.kind === "all") {
    return ALL_SERVER_SCOPE;
  }
  return connections.some((connection) => connection.id === requested.connectionId)
    ? requested
    : ALL_SERVER_SCOPE;
}

/** Returns the lower read qualifier represented by a V1 server scope. */
export function serverScopeConnectionId(scope: ServerScope): string | null {
  return scope.kind === "connection" ? scope.connectionId : null;
}

/** Tests a server-qualified row against the current V1 list scope. */
export function serverScopeIncludes(scope: ServerScope, connectionId: string): boolean {
  return scope.kind === "all" || scope.connectionId === connectionId;
}

/** Owns the V1 All-or-one list scope without creating a route destination. */
export function useServerScope(
  connections: readonly StoredConnection[],
  resetThreadList: () => void,
  desktopDefaultThreadInitiallyEnabled = true,
): ServerScopeBinding {
  const [requested, setRequested] = useState<ServerScope>(ALL_SERVER_SCOPE);
  const [desktopDefaultThreadEnabled, setDesktopDefaultThreadEnabled] = useState(
    desktopDefaultThreadInitiallyEnabled,
  );
  const scope = normalizeServerScope(requested, connections);
  const consumeDesktopDefaultThread = useEvent((): void => {
    setDesktopDefaultThreadEnabled(false);
  });
  const select = useEvent((next: ServerScope): void => {
    resetThreadList();
    consumeDesktopDefaultThread();
    setRequested(next);
  });
  return { consumeDesktopDefaultThread, desktopDefaultThreadEnabled, scope, select };
}
