import {
  GlobalSupervisorLowerRuntimeStartError,
  type GlobalSupervisorLowerRuntime,
  type GlobalSupervisorRuntimeRecoveryAction,
} from "../../data/globalSupervisorRuntime";
import {
  type GlobalSupervisorRecovery,
  type GlobalSupervisorRuntime,
  GlobalSupervisorStartError,
} from "./globalSupervisorContract";

function recovery(action: GlobalSupervisorRuntimeRecoveryAction): GlobalSupervisorRecovery {
  switch (action) {
    case "chooseHome":
      return { action, label: "Choose home server" };
    case "reconnectHome":
      return { action, label: "Reconnect home server" };
    case "reconcileBinding":
      return { action, label: "Repair supervisor binding" };
    case "recreateBinding":
      return { action, label: "Recreate supervisor" };
    case "retryCapabilityProbe":
      return { action, label: "Retry voice check" };
    case "retryMicrophoneBusy":
      return { action, label: "Try microphone again" };
    default:
      return unreachableRecovery(action);
  }
}

function unreachableRecovery(action: never): never {
  throw new Error(`Unhandled Global Voice recovery: ${String(action)}`);
}

/** Adapts lower runtime states to the feature-owned presentation recovery contract. */
export function createGlobalSupervisorWorkspaceAdapter(
  runtime: GlobalSupervisorLowerRuntime,
): GlobalSupervisorRuntime {
  return {
    async prepare(publish) {
      const result = await runtime.prepare((homeConnectionId) => {
        publish({ homeConnectionId, status: "creating" });
      });
      if (result.status === "ready") {
        return result;
      }
      return result.status === "unbound"
        ? { recovery: recovery(result.recovery), status: "unbound" }
        : {
            failure: result.failure,
            recovery: recovery(result.recovery),
            status: "failed",
          };
    },
    async recover(next) {
      await runtime.recover(next.action);
    },
    async start(home, publish) {
      try {
        return await runtime.start(home, (event) => {
          publish(
            event.event === "failed"
              ? {
                  activationId: event.activationId,
                  event: event.event,
                  failure: event.failure,
                  recovery: recovery(event.recovery),
                }
              : event,
          );
        });
      } catch (error) {
        if (error instanceof GlobalSupervisorLowerRuntimeStartError) {
          throw new GlobalSupervisorStartError(error.failure, recovery(error.recovery));
        }
        throw error;
      }
    },
  };
}
