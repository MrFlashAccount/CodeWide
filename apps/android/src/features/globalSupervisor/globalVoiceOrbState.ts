import type { GlobalVoiceOrbState } from "../../native/globalVoiceOverlayActions";
import type { GlobalSupervisorRenderSnapshot } from "./globalSupervisorContract";

/** Maps every current supervisor phase into the smaller renderer state contract. */
export function globalVoiceOrbStateForPhase(
  phase: GlobalSupervisorRenderSnapshot["phase"],
): GlobalVoiceOrbState {
  switch (phase) {
    case "activating":
    case "creating":
    case "reconnecting":
    case "starting":
      return "connecting";
    case "failed":
      return "error";
    case "listening":
      return "listening";
    case "speaking":
      return "speaking";
    case "thinking":
    case "toolActivity":
      return "thinking";
    case "ready":
      return "idle";
    case "stopping":
    case "unbound":
      return "disabled";
    default:
      return unreachableSupervisorPhase(phase);
  }
}

function unreachableSupervisorPhase(phase: never): never {
  throw new Error(`Unhandled Global Voice overlay phase: ${String(phase)}`);
}
