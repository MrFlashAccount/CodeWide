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

/**
 * Discards every snapshot written with another value. Restored query data is
 * already-decoded data and bypasses the wire decoders, so a snapshot whose
 * decoded shape differs from the current contracts reaches components as-is.
 *
 * The suffix is the shape signature recorded by
 * `test/forge-query-cache-compatibility.test.ts`; that test fails whenever a
 * decoded shape of a persisted kind changes, so a shape change cannot ship
 * without a new buster. A semantic change with the same shape (entry order,
 * the meaning of a value) is invisible to the signature: bump the buster by
 * hand, for example by appending `-2`, and note it below.
 *
 * History: v1 → v2 added the required PR attention discriminant. v2 → this
 * value covers decoded shapes changed without a bump: conversation events
 * gained `commits`, review threads gained `excerpt` and issue resolutions
 * `viewerCanToggle`, and conversation pages became newest-first.
 */
const FORGE_QUERY_CACHE_BUSTER = "forge-query-cache-7ea41d187db7";

/**
 * The only `[owner, kind]` query families restored from disk. An allowlist, so
 * a new resource is not persisted until its decoded shape joins the
 * compatibility signature. Live scenario states are excluded (a restored
 * `running` would show a run that may have ended while the app was closed), as
 * are whole head files (up to 1 MiB each; the diff keeps its patch view until
 * one is read again).
 */
export const PERSISTED_FORGE_QUERY_KINDS = [
  "forge/accounts",
  "forge/activity",
  "forge/conversation",
  "forge/files",
  "forge/lists",
  "forge/overview",
  "review/drafts",
  "review/guide",
  "review/hunks",
] as const;

const persistedQueryKinds: ReadonlySet<string> = new Set(PERSISTED_FORGE_QUERY_KINDS);

function isForgeServerQuery(query: Query): boolean {
  const [owner, kind] = query.queryKey;
  return (
    typeof owner === "string" &&
    typeof kind === "string" &&
    persistedQueryKinds.has(`${owner}/${kind}`) &&
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
