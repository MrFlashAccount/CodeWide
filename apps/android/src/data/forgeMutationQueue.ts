import { MutationObserver, type QueryClient } from "@tanstack/react-query";
import type { RpcClient } from "@codewide/sync-client";

import { appLogger } from "../observability/logger";
import { classifyForgeError } from "./forgeErrors";
import {
  createForgeMutationEnvelope,
  parseForgeMutationEnvelope,
  type DurableForgeMethod,
  type ForgeMutationEnvelope,
} from "./forgeMutationEnvelope";
import type { createWorkspaceSession } from "./workspace-session";

const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 30_000;
const RETRY_BACKOFF_BASE = 2;
const RETRY_BACKOFF_EXPONENT_CAP = 6;
const FORGE_MUTATION_KEY = ["forge", "durable-mutation"] as const;

/** Serializable input admitted to the persisted Forge mutation pipeline. */
type ForgeMutationRequest = {
  readonly connectionId: string;
  readonly method: DurableForgeMethod;
  readonly operationId: string;
  readonly params: unknown;
  readonly scope: string;
};

/** Process-owned mutation queue backed by TanStack MutationCache and its persister. */
export type ForgeMutationQueue = {
  readonly execute: <Result>(
    request: ForgeMutationRequest,
    decode: (value: unknown) => Result,
  ) => Promise<Result>;
  readonly pending: () => readonly ForgeMutationEnvelope[];
};

type MutationAuthority = {
  readonly getSession: (connectionId: string) => RpcClient | undefined;
  readonly rpcAfterAttach: ReturnType<typeof createWorkspaceSession>["rpcAfterAttach"];
};

function retryDelay(attempt: number): number {
  return Math.min(
    RETRY_BASE_DELAY_MS * RETRY_BACKOFF_BASE ** Math.min(attempt, RETRY_BACKOFF_EXPONENT_CAP),
    RETRY_MAX_DELAY_MS,
  );
}

function pendingEnvelopes(client: QueryClient): readonly ForgeMutationEnvelope[] {
  return client
    .getMutationCache()
    .getAll()
    .flatMap((mutation) => {
      if (mutation.state.status !== "pending") {
        return [];
      }
      const envelope = parseForgeMutationEnvelope(mutation.state.variables);
      return envelope === null ? [] : [envelope];
    });
}

function queryBelongsToConnection(queryKey: readonly unknown[], connectionId: string): boolean {
  return queryKey.some(
    (part) =>
      part === connectionId ||
      (typeof part === "string" && part.startsWith(`${connectionId}\u0000`)),
  );
}

/** Registers the serializable default mutation function required for replay. */
export function registerForgeMutationDefaults({
  authority,
  client,
}: {
  readonly authority: MutationAuthority;
  readonly client: QueryClient;
}): void {
  const send = async (envelope: ForgeMutationEnvelope): Promise<unknown> => {
    const session = authority.getSession(envelope.connectionId);
    if (session === undefined) {
      throw new Error("The server is not connected");
    }
    return authority.rpcAfterAttach<unknown>(session, envelope.method, envelope.params);
  };
  client.setMutationDefaults(FORGE_MUTATION_KEY, {
    gcTime: Number.POSITIVE_INFINITY,
    meta: { durableForgeMutation: true },
    mutationFn: send,
    networkMode: "online",
    onSettled(_data, _error, variables) {
      const envelope = parseForgeMutationEnvelope(variables);
      if (envelope === null) {
        return;
      }
      client
        .invalidateQueries({
          predicate: (query) => queryBelongsToConnection(query.queryKey, envelope.connectionId),
        })
        .catch((error: unknown) => {
          appLogger.warnCaught({ error, event: "forge.mutation.invalidate_failed" });
        });
    },
    retry(_failureCount, error) {
      return classifyForgeError(error).kind === "unreachable";
    },
    retryDelay,
  });
}

/** Executes replay-safe writes through the shared TanStack MutationCache. */
export function createForgeMutationQueue({
  client,
  restored,
}: {
  readonly client: QueryClient;
  readonly restored: Promise<void>;
}): ForgeMutationQueue {
  return {
    async execute(request, decode) {
      await restored;
      const envelope = createForgeMutationEnvelope(request);
      const observer = new MutationObserver<unknown, Error, ForgeMutationEnvelope>(client, {
        mutationKey: FORGE_MUTATION_KEY,
        scope: { id: envelope.scope },
      });
      try {
        return decode(await observer.mutate(envelope));
      } finally {
        observer.reset();
      }
    },
    pending: () => pendingEnvelopes(client),
  };
}
