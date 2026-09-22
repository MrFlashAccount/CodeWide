import type { SyncServerRequest } from "@codewide/sync-client";
import type { StoredConnection } from "./connection-profile-types";
import type { GlobalSupervisorAttentionOwner } from "./globalSupervisorAttention";
import {
  createGlobalSupervisorBindingOwner,
  type GlobalSupervisorBindingDatabase,
  type GlobalSupervisorBindingOwner,
} from "./globalSupervisorBinding";
import { createGlobalSupervisorBindingDatabase } from "./globalSupervisorBindingDatabase";
import { globalSupervisorRequestCommandId } from "./globalSupervisorRequestIdentity";
import { createGlobalSupervisorSystemRequestDispatcher } from "./globalSupervisorSystemRequests";
import { createGlobalSupervisorThreadRemote } from "./globalSupervisorThreadRemote";
import { createGlobalSupervisorToolCapabilities } from "./globalSupervisorTools";
import { createGlobalSupervisorToolRouter } from "./globalSupervisorToolRouter";
import {
  createGlobalSupervisorToolTargetPolicy,
  type GlobalSupervisorToolTargetPolicy,
} from "./globalSupervisorToolTarget";
import type { VoiceAssistantPersonality } from "./voiceAssistantPersonality";
import type { WorkspaceSyncSession } from "./workspace-session";

type GlobalSupervisorRpc = <Result>(
  session: WorkspaceSyncSession,
  method: string,
  params: unknown,
) => Promise<Result>;

type GlobalSupervisorWorkspaceBinding = {
  readonly binding: GlobalSupervisorBindingOwner;
  readonly targetPolicy: GlobalSupervisorToolTargetPolicy;
};

type GlobalSupervisorWorkspaceSystemRequests = {
  readonly replace: (connectionId: string, requests: readonly SyncServerRequest[]) => Promise<void>;
};

/** Creates the supervisor binding and tool-target guard independently of catalog hydration. */
export async function createGlobalSupervisorWorkspaceBinding(options: {
  readonly getSession: (connectionId: string) => WorkspaceSyncSession | undefined;
  readonly personality: () => Promise<VoiceAssistantPersonality>;
  readonly randomUUID: () => string;
  readonly rpcAfterAttach: GlobalSupervisorRpc;
}): Promise<GlobalSupervisorWorkspaceBinding> {
  const persisted = createGlobalSupervisorBindingDatabase();
  await persisted.ready;
  let current = await persisted.read();
  const database: GlobalSupervisorBindingDatabase = {
    async clear() {
      await persisted.clear();
      current = null;
    },
    async read() {
      current = await persisted.read();
      return current;
    },
    ready: persisted.ready,
    async write(binding) {
      await persisted.write(binding);
      current = binding;
    },
  };
  const binding = createGlobalSupervisorBindingOwner({
    database,
    randomUUID: options.randomUUID,
    remote: createGlobalSupervisorThreadRemote(options),
  });
  return {
    binding,
    targetPolicy: createGlobalSupervisorToolTargetPolicy(() => current),
  };
}

/** Composes the bound-home system request path separately from workspace startup. */
export function createGlobalSupervisorWorkspaceSystemRequests(options: {
  readonly attention: GlobalSupervisorAttentionOwner;
  readonly binding: Awaited<ReturnType<typeof createGlobalSupervisorWorkspaceBinding>>["binding"];
  readonly currentConnections: () => StoredConnection[];
  readonly getSession: (connectionId: string) => WorkspaceSyncSession | undefined;
  readonly isRpcAvailable: (connectionId: string) => boolean;
  readonly isSupervisorActive: () => boolean;
  readonly respond: (request: {
    readonly connectionId: string;
    readonly requestId: string | number;
    readonly result: unknown;
  }) => Promise<void>;
  readonly rpcAfterAttach: GlobalSupervisorRpc;
  readonly sendSystemText: (request: {
    readonly commandId: string;
    readonly connectionId: string;
    readonly text: string;
    readonly threadId: string;
  }) => Promise<string>;
  readonly targetPolicy: Awaited<
    ReturnType<typeof createGlobalSupervisorWorkspaceBinding>
  >["targetPolicy"];
}): GlobalSupervisorWorkspaceSystemRequests {
  return createGlobalSupervisorSystemRequestDispatcher({
    binding: options.binding,
    handler: createGlobalSupervisorToolRouter(
      createGlobalSupervisorToolCapabilities({
        attention: options.attention,
        currentConnections: options.currentConnections,
        deriveTargetSendCommandId: async (request) =>
          globalSupervisorRequestCommandId("targetSend", request),
        deriveWorkerCreationSource: async (request) =>
          globalSupervisorRequestCommandId("workerCreate", request),
        getSession: options.getSession,
        isRpcAvailable: options.isRpcAvailable,
        respond: options.respond,
        rpcAfterAttach: options.rpcAfterAttach,
        sendSystemText: options.sendSystemText,
        targetPolicy: options.targetPolicy,
      }),
    ),
    isActive: options.isSupervisorActive,
  });
}
