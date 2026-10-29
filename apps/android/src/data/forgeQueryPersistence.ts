import {
  defaultShouldDehydrateMutation,
  defaultShouldDehydrateQuery,
  type Mutation,
  type Query,
  type QueryClient,
} from "@tanstack/react-query";
import {
  persistQueryClient,
  persistQueryClientSubscribe,
  type Persister,
} from "@tanstack/react-query-persist-client";

import { appLogger } from "../observability/logger";
import { parseForgeMutationEnvelope } from "./forgeMutationEnvelope";

const CACHE_MAX_AGE_MS = 604_800_000;
// V2 adds the required in-memory PR attention discriminant. V1 snapshots may
// contain rows without it because persisted query data bypasses wire decoding.
const FORGE_QUERY_CACHE_BUSTER = "forge-query-cache-v2";

function isForgeServerQuery(query: Query): boolean {
  const owner = query.queryKey[0];
  // Live scenario states are not restored: a persisted `running` would show a run that may have
  // ended while the app was closed.
  return (
    (owner === "forge" || owner === "review") &&
    query.queryKey[1] !== "scenarios" &&
    defaultShouldDehydrateQuery(query)
  );
}

function isDurableForgeMutation(mutation: Mutation): boolean {
  return (
    defaultShouldDehydrateMutation(mutation) &&
    mutation.meta?.durableForgeMutation === true &&
    parseForgeMutationEnvelope(mutation.state.variables) !== null
  );
}

/**
 * Restores and continuously persists the shared QueryClient through TanStack's
 * official persistence lifecycle. The application supplies only selection
 * policy and the default mutation function required for replay.
 */
export function persistForgeQueryClient(
  queryClient: QueryClient,
  persister: Persister,
): { readonly restored: Promise<void>; readonly stop: () => void } {
  const options = {
    buster: FORGE_QUERY_CACHE_BUSTER,
    dehydrateOptions: {
      shouldDehydrateMutation: isDurableForgeMutation,
      shouldDehydrateQuery: isForgeServerQuery,
    },
    hydrateOptions: {
      defaultOptions: { queries: { gcTime: CACHE_MAX_AGE_MS } },
    },
    maxAge: CACHE_MAX_AGE_MS,
    persister,
    queryClient,
  };
  const [initialStop, restore] = persistQueryClient(options);
  let stop = initialStop;
  const restored = restore.catch((error: unknown) => {
    appLogger.errorCaught({ error, event: "forge.query_cache.restore_failed" });
    // Keep future cache changes persistent after the failed restore path.
    stop = persistQueryClientSubscribe(options);
  });
  return {
    restored,
    stop: () => {
      stop();
    },
  };
}
