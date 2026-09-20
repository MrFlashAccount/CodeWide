import type { SyncServerRequest } from "@codewide/sync-client";

import type { GlobalSupervisorBindingOwner } from "./globalSupervisorBinding";
import type {
  GlobalSupervisorSystemRequest,
  GlobalSupervisorToolFailureKind,
} from "./globalSupervisorToolRouter";
import { unknownRecord } from "./unknownRecord";

export type GlobalSupervisorSystemRequestHandler = {
  readonly fail: (
    request: GlobalSupervisorSystemRequest,
    kind: GlobalSupervisorToolFailureKind,
  ) => Promise<void>;
  readonly handle: (request: GlobalSupervisorSystemRequest) => Promise<void>;
};

type ReadyBinding = Extract<
  Awaited<ReturnType<GlobalSupervisorBindingOwner["read"]>>,
  { readonly status: "ready" }
>;

function activeRequestKeys(
  connectionId: string,
  requests: readonly SyncServerRequest[],
): ReadonlySet<string> {
  return new Set(
    requests
      .filter((request) => request.method === "item/tool/call")
      .map((request) => requestKey(connectionId, request.id)),
  );
}

function releaseInactiveClaims(
  claimed: Set<string>,
  connectionId: string,
  activeKeys: ReadonlySet<string>,
): void {
  for (const key of claimed) {
    if (key.startsWith(`${connectionId}\u0000`) && !activeKeys.has(key)) {
      claimed.delete(key);
    }
  }
}

function claimRequest(options: {
  readonly claimed: Set<string>;
  readonly connectionId: string;
  readonly isActive: () => boolean;
  readonly request: SyncServerRequest;
}): string | null {
  if (options.request.method !== "item/tool/call" || !options.isActive()) {
    return null;
  }
  const key = requestKey(options.connectionId, options.request.id);
  if (options.claimed.has(key)) {
    return null;
  }
  options.claimed.add(key);
  return key;
}

async function handleClaimedRequest(options: {
  readonly binding: ReadyBinding | null;
  readonly claimed: Set<string>;
  readonly connectionId: string;
  readonly handler: GlobalSupervisorSystemRequestHandler;
  readonly isActive: () => boolean;
  readonly key: string;
  readonly request: SyncServerRequest;
}): Promise<void> {
  const systemRequest = {
    connectionId: options.connectionId,
    params: options.request.params,
    requestId: options.request.id,
    ...(options.binding === null ? {} : { supervisor: options.binding.home }),
  };
  if (!options.isActive()) {
    options.claimed.delete(options.key);
    return;
  }
  const params = unknownRecord(options.request.params);
  if (
    options.binding === null ||
    options.binding.home.connectionId !== options.connectionId ||
    params?.threadId !== options.binding.home.threadId
  ) {
    await options.handler.fail(systemRequest, "requestNotAdmitted");
    return;
  }
  await options.handler.handle(systemRequest);
}

async function dispatchRequest(options: {
  readonly binding: ReadyBinding | null;
  readonly claimed: Set<string>;
  readonly connectionId: string;
  readonly handler: GlobalSupervisorSystemRequestHandler;
  readonly isActive: () => boolean;
  readonly request: SyncServerRequest;
}): Promise<void> {
  const key = claimRequest({
    claimed: options.claimed,
    connectionId: options.connectionId,
    isActive: options.isActive,
    request: options.request,
  });
  if (key === null) {
    return;
  }
  try {
    await handleClaimedRequest({
      binding: options.binding,
      claimed: options.claimed,
      connectionId: options.connectionId,
      handler: options.handler,
      isActive: options.isActive,
      key,
      request: options.request,
    });
  } catch (error: unknown) {
    options.claimed.delete(key);
    throw error;
  }
}

/** Separates bound-home dynamic tools from the unchanged user-interaction projection. */
export function createGlobalSupervisorSystemRequestDispatcher(options: {
  readonly binding: GlobalSupervisorBindingOwner;
  readonly handler: GlobalSupervisorSystemRequestHandler;
  readonly isActive: () => boolean;
}): {
  readonly replace: (connectionId: string, requests: readonly SyncServerRequest[]) => Promise<void>;
} {
  const claimed = new Set<string>();
  return {
    async replace(connectionId, requests) {
      releaseInactiveClaims(claimed, connectionId, activeRequestKeys(connectionId, requests));
      if (!options.isActive()) {
        return;
      }
      const current = await options.binding.read();
      if (!options.isActive()) {
        return;
      }
      const binding = current?.status === "ready" ? current : null;
      for (const request of requests) {
        await dispatchRequest({
          binding,
          claimed,
          connectionId,
          handler: options.handler,
          isActive: options.isActive,
          request,
        });
      }
    },
  };
}

function requestKey(connectionId: string, requestId: string | number): string {
  return `${connectionId}\u0000${typeof requestId}:${JSON.stringify(requestId)}`;
}
