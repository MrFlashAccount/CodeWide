import type { HostUpdatePhase, HostUpdatePlatform } from "./hostUpdateContract";

/** Capability/loading classification rendered on a server settings page. */
type HostUpdateAvailability =
  | "loading"
  | "ready"
  | "unsupported"
  | "manualBootstrap"
  | "unofficialBuild"
  | "manualUpdate"
  | "error";

/** Public Connections projection consumed by Settings without transport authority. */
export type HostUpdateView = {
  readonly availability: HostUpdateAvailability;
  readonly canApply: boolean;
  readonly canCheck: boolean;
  readonly canRetry: boolean;
  readonly currentVersion: string | null;
  readonly disconnected: boolean;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly latestVersion: string | null;
  readonly operationId: string | null;
  readonly phase: HostUpdatePhase | null;
  readonly platform: HostUpdatePlatform | null;
  readonly targetFingerprint: string | null;
};
