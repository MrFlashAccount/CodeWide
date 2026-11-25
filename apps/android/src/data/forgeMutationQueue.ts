import {
  MutationObserver,
  useMutationState,
  type Mutation,
  type QueryClient,
} from "@tanstack/react-query";
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
  /**
   * Drops the settled write `operationId` from the cache once its owner has
   * consumed the outcome; a write still queued or in flight is never dropped.
   */
  readonly forget: (operationId: string) => void;
  readonly pending: () => readonly ForgeMutationEnvelope[];
};

/** One write of the persisted pipeline as a screen shows it before the read model has it. */
export type ForgeMutationView =
  | { readonly envelope: ForgeMutationEnvelope; readonly status: "pending" | "success" }
  | { readonly envelope: ForgeMutationEnvelope; readonly error: string; readonly status: "error" };

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

function viewOf(mutation: Mutation): ForgeMutationView | null {
  const envelope = parseForgeMutationEnvelope(mutation.state.variables);
  if (envelope === null || mutation.state.status === "idle") {
    return null;
  }
  return mutation.state.status === "error"
    ? { envelope, error: classifyForgeError(mutation.state.error).message, status: "error" }
    : { envelope, status: mutation.state.status };
}

/**
 * Subscribes to the persisted writes of `method` that `include` keeps, read
 * from the shared MutationCache during render: a queued or in-flight write, an
 * acknowledged one its owner has not forgotten yet, and a failed one with the
 * Companion's reason. TanStack Query owns this state; nothing mirrors it.
 */
export function useForgeMutations(
  client: QueryClient,
  method: DurableForgeMethod,
  include: (envelope: ForgeMutationEnvelope) => boolean,
): readonly ForgeMutationView[] {
  const views = useMutationState(
    {
      filters: {
        mutationKey: FORGE_MUTATION_KEY,
        predicate: (mutation) => {
          const envelope = parseForgeMutationEnvelope(mutation.state.variables);
          return envelope !== null && envelope.method === method && include(envelope);
        },
      },
      select: viewOf,
    },
    client,
  );
  return views.filter((view) => view !== null);
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
      // The detail screen hides this exact revision immediately. Refetching
      // here would also move the row between attention groups while it is open.
      if (envelope.method === "companion/pullRequest/attention/seen") {
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
    forget(operationId) {
      const cache = client.getMutationCache();
      for (const mutation of cache.getAll()) {
        if (
          mutation.state.status !== "pending" &&
          parseForgeMutationEnvelope(mutation.state.variables)?.operationId === operationId
        ) {
          cache.remove(mutation);
        }
      }
    },
    pending: () => pendingEnvelopes(client),
  };
}
