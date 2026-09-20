import {
  GLOBAL_SUPERVISOR_THREAD_SOURCE_PREFIX,
  type GlobalSupervisorBinding,
} from "./globalSupervisorBinding";

export type GlobalSupervisorSummaryStorageDecision = "delete" | "preserve" | "write";

/** Storage policy separate from fail-closed presentation admission. */
export type GlobalSupervisorSummaryStoragePolicy = {
  readonly classifyRef: (
    connectionId: string,
    threadId: string,
  ) => GlobalSupervisorSummaryStorageDecision;
  readonly classifyThread: (
    connectionId: string,
    thread: { readonly id: string; readonly source?: string | null },
  ) => GlobalSupervisorSummaryStorageDecision;
  readonly mayPruneMissing: (connectionId: string) => boolean;
  readonly shouldDeletePersistedRef: (connectionId: string, threadId: string) => boolean;
};

function exactHome(
  binding: GlobalSupervisorBinding,
): { readonly connectionId: string; readonly threadId: string } | null {
  return binding.status === "ready"
    ? binding.home
    : binding.status === "invalid"
      ? binding.priorHome
      : null;
}

function classifyRef(
  binding: GlobalSupervisorBinding | null,
  connectionId: string,
  threadId: string,
): GlobalSupervisorSummaryStorageDecision {
  if (binding === null) {
    return "write";
  }
  const home = exactHome(binding);
  if (home !== null) {
    return home.connectionId === connectionId && home.threadId === threadId ? "delete" : "write";
  }
  if (binding.status === "creating" && binding.homeConnectionId !== connectionId) {
    return "write";
  }
  return "preserve";
}

/** Owns exact hidden-row deletion without turning uncertain admission into data loss. */
export function createGlobalSupervisorSummaryStoragePolicy(
  readBinding: () => GlobalSupervisorBinding | null,
): GlobalSupervisorSummaryStoragePolicy {
  return {
    classifyRef(connectionId, threadId) {
      return classifyRef(readBinding(), connectionId, threadId);
    },
    classifyThread(connectionId, thread) {
      const binding = readBinding();
      if (
        binding?.status === "creating" &&
        binding.homeConnectionId === connectionId &&
        thread.source === `${GLOBAL_SUPERVISOR_THREAD_SOURCE_PREFIX}${binding.creationToken}`
      ) {
        return "delete";
      }
      return classifyRef(binding, connectionId, thread.id);
    },
    mayPruneMissing(connectionId) {
      const binding = readBinding();
      return !(
        (binding?.status === "creating" && binding.homeConnectionId === connectionId) ||
        (binding?.status === "invalid" && binding.priorHome === null)
      );
    },
    shouldDeletePersistedRef(connectionId, threadId) {
      return classifyRef(readBinding(), connectionId, threadId) === "delete";
    },
  };
}
