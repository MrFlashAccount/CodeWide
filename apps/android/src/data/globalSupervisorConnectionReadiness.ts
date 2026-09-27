import type { ConnectionStateModel } from "./connection-state-model";
import type { GlobalSupervisorReadiness } from "./globalSupervisorRecoveryPolicy";

/** Adapts immediate home-server RPC admission, never a delayed UI or OS network label. */
export function globalSupervisorConnectionReadiness(
  model: ConnectionStateModel | null,
  connectionId: string,
): GlobalSupervisorReadiness {
  return {
    read() {
      const row = model?.rows$.peek().find((candidate) => candidate.connectionId === connectionId);
      if (row === undefined || !row.enabled || row.state === "authRequired") {
        return "blocked";
      }
      return row.rpcAvailable ? "ready" : "waiting";
    },
    subscribe(changed) {
      return model?.rows$.onChange(changed) ?? (() => undefined);
    },
  };
}
