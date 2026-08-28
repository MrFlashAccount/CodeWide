import type { RemoteConnectionState, SyncV2ConnectionState, SyncV2SafeDiagnostic } from "@codewide/sync-client";

export type SyncV2ConnectionPresentation = {
  state: RemoteConnectionState;
  diagnostic: string | null;
};

/** UI consumes only transport state and bounded content-free diagnostics. */
export function projectSyncV2ConnectionState(
  state: SyncV2ConnectionState,
  diagnostic: SyncV2SafeDiagnostic | null,
): SyncV2ConnectionPresentation {
  const projectedState: RemoteConnectionState = state === "initializing" || state === "reinitializing"
    ? "syncing"
    : state === "error" ? "degraded" : state;
  return { state: projectedState, diagnostic: safeDiagnostic(diagnostic) };
}

function safeDiagnostic(diagnostic: SyncV2SafeDiagnostic | null): string | null {
  if (diagnostic === null) return null;
  if (diagnostic.code === "transport") return "Sync V2 transport is unavailable";
  if (diagnostic.code === "protocol") return "Sync V2 protocol validation failed";
  if (diagnostic.code === "projection") return "Sync V2 local projection could not commit";
  return "Sync V2 is rebuilding authoritative state";
}
