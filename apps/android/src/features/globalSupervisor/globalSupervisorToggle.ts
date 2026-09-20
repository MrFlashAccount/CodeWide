import type { GlobalSupervisorRenderSnapshot } from "./globalSupervisorContract";

/** Maps the full supervisor state machine to the single app-level toggle state. */
export function globalSupervisorToggleState(
  snapshot: GlobalSupervisorRenderSnapshot,
): "idle" | "starting" | "active" | "reconnecting" | "stopping" {
  const phase = snapshot.phase;
  switch (phase) {
    case "activating":
    case "creating":
    case "starting":
      return "starting";
    case "stopping":
      return "stopping";
    case "listening":
    case "speaking":
    case "thinking":
    case "toolActivity":
      return "active";
    case "reconnecting":
      return "reconnecting";
    case "failed":
    case "ready":
    case "unbound":
      return "idle";
    default:
      return unreachablePhase(phase);
  }
}

function unreachablePhase(phase: never): never {
  throw new Error(`Unhandled Global Voice phase: ${String(phase)}`);
}
