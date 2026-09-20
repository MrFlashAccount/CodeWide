import {
  GLOBAL_SUPERVISOR_THREAD_SOURCE_PREFIX,
  type GlobalSupervisorBinding,
} from "./globalSupervisorBinding";

export type GlobalSupervisorVisibilityPolicy = {
  readonly allowsOrdinaryRef: (connectionId: string, threadId: string) => boolean;
  readonly allowsOrdinaryThread: (
    connectionId: string,
    thread: { readonly id: string; readonly source?: string | null },
  ) => boolean;
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

function allowsBoundThread(
  binding: GlobalSupervisorBinding,
  connectionId: string,
  thread: { readonly id: string; readonly source?: string | null },
): boolean {
  if (binding.status !== "creating") {
    return allowsBoundRef(binding, connectionId, thread.id);
  }
  if (binding.homeConnectionId !== connectionId) {
    return true;
  }
  return thread.source !== `${GLOBAL_SUPERVISOR_THREAD_SOURCE_PREFIX}${binding.creationToken}`;
}

/** Admits ordinary chats only when the durable binding can classify them safely. */
export function createGlobalSupervisorVisibilityPolicy(
  readBinding: () => GlobalSupervisorBinding | null,
): GlobalSupervisorVisibilityPolicy {
  const allowsOrdinaryRef = (connectionId: string, threadId: string): boolean => {
    const binding = readBinding();
    return binding === null || allowsBoundRef(binding, connectionId, threadId);
  };
  return {
    allowsOrdinaryRef,
    allowsOrdinaryThread(connectionId, thread) {
      const binding = readBinding();
      return binding === null || allowsBoundThread(binding, connectionId, thread);
    },
  };
}
