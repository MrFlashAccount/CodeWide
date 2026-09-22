import type { GlobalSupervisorBinding } from "./globalSupervisorBinding";

export type GlobalSupervisorToolTargetPolicy = {
  readonly allowsTarget: (connectionId: string, threadId: string) => boolean;
};

function allowsBoundRef(
  binding: GlobalSupervisorBinding,
  connectionId: string,
  threadId: string,
): boolean {
  if (binding.status === "creating") {
    return binding.homeConnectionId !== connectionId;
  }
  const home = binding.status === "ready" ? binding.home : binding.priorHome;
  if (home === null) {
    return false;
  }
  return home.connectionId !== connectionId || home.threadId !== threadId;
}

/** Prevents a bound supervisor from using a worker tool against itself. Not a catalog filter. */
export function createGlobalSupervisorToolTargetPolicy(
  readBinding: () => GlobalSupervisorBinding | null,
): GlobalSupervisorToolTargetPolicy {
  return {
    allowsTarget(connectionId, threadId) {
      const binding = readBinding();
      return binding === null || allowsBoundRef(binding, connectionId, threadId);
    },
  };
}
