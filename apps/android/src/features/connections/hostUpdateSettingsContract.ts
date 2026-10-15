import type { HostUpdatePhase, HostUpdatePlatform, HostUpdateProgress } from "./hostUpdateContract";

/** Capability/loading classification rendered on a server settings page. */
type HostUpdateAvailability =
  | "loading"
  | "ready"
  | "unsupported"
  | "manualBootstrap"
  | "unofficialBuild"
  | "manualUpdate"
  | "error";

/**
 * A local request the server has not answered yet. The card keeps the last
 * confirmed text and shimmers it; a server response or failure clears it.
 */
type HostUpdatePendingRequest = "apply" | "check";

/** Public Connections projection consumed by Settings without transport authority. */
export type HostUpdateView = {
  readonly availability: HostUpdateAvailability;
  readonly canApply: boolean;
  readonly canCheck: boolean;
  readonly canRetry: boolean;
  readonly currentVersion: string | null;
  /**
   * The shown state is the last confirmed one: the connection is down or a
   * fresh read failed transiently (the server is restarting or unreachable),
   * and the resource waits for fresh status.
   */
  readonly disconnected: boolean;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly latestVersion: string | null;
  readonly operationId: string | null;
  readonly pending: HostUpdatePendingRequest | null;
  readonly phase: HostUpdatePhase | null;
  readonly platform: HostUpdatePlatform | null;
  readonly progress: HostUpdateProgress | null;
  readonly targetFingerprint: string | null;
};
