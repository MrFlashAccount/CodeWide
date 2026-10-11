import { observable, type Observable } from "@legendapp/state";
import { RpcResponseError, type RpcClient } from "@codewide/sync-client";

import {
  AGENT_PROVIDERS_READ_METHOD,
  agentProvidersValue,
  parseAgentProvidersResult,
  type AgentProvidersState,
} from "./agentProviders";
import type { createWorkspaceSession } from "./workspace-session";

const METHOD_NOT_FOUND_RPC_CODE = -32_601;

/** Session access used to read a server's provider list. */
export type AgentProvidersAuthority = {
  readonly getSession: (connectionId: string) => RpcClient | undefined;
  readonly rpcAfterAttach: ReturnType<typeof createWorkspaceSession>["rpcAfterAttach"];
};

/** Model-owned per-connection provider list; RPC data never lives in component state. */
export type AgentProvidersResource = {
  /** Publishes a durable `companion/agentProviders/changed` payload. Invalid payloads are ignored. */
  readonly applyChanged: (connectionId: string, params: unknown) => boolean;
  /** Reads the list again; concurrent calls for one connection share the request. */
  readonly refresh: (connectionId: string) => Promise<void>;
  readonly state$: Observable<Record<string, AgentProvidersState>>;
};

/**
 * Owns the provider list of every connection. A refresh keeps the last snapshot
 * visible while it runs; an older Companion that does not know the method is
 * recorded as `unsupported`, which consumers render exactly as before.
 */
export function createAgentProvidersResource({
  getSession,
  rpcAfterAttach,
}: AgentProvidersAuthority): AgentProvidersResource {
  const state$ = observable<Record<string, AgentProvidersState>>({});
  const inFlight = new Map<string, Promise<void>>();
  const current = (connectionId: string): AgentProvidersState =>
    state$[connectionId]?.peek() ?? { status: "idle" };
  const put = (connectionId: string, state: AgentProvidersState): void => {
    state$[connectionId]?.set(state);
  };
  const read = async (connectionId: string): Promise<void> => {
    const previous = current(connectionId);
    const value = agentProvidersValue(previous);
    put(connectionId, { status: "loading", value });
    const session = getSession(connectionId);
    try {
      if (session === undefined) {
        throw new Error("Connection is not enabled");
      }
      const parsed = parseAgentProvidersResult(
        await rpcAfterAttach<unknown>(session, AGENT_PROVIDERS_READ_METHOD, {}),
      );
      if (parsed === null) {
        throw new Error("The server sent an invalid agent provider list");
      }
      put(connectionId, { status: "ready", value: parsed });
    } catch (error) {
      if (error instanceof RpcResponseError && error.code === METHOD_NOT_FOUND_RPC_CODE) {
        put(connectionId, { status: "unsupported" });
        return;
      }
      put(connectionId, {
        error: error instanceof Error ? error.message : "Could not read agent providers",
        status: "error",
        value,
      });
      throw error;
    }
  };
  return {
    applyChanged(connectionId, params) {
      const parsed = parseAgentProvidersResult(params);
      if (parsed === null) {
        return false;
      }
      put(connectionId, { status: "ready", value: parsed });
      return true;
    },
    async refresh(connectionId) {
      const pending = inFlight.get(connectionId);
      if (pending !== undefined) {
        return pending;
      }
      const operation = read(connectionId).finally(() => {
        inFlight.delete(connectionId);
      });
      inFlight.set(connectionId, operation);
      return operation;
    },
    state$,
  };
}
