/**
 * Drafts, guide state and hunk catalogs keyed by diff source. These are
 * progressive queries: each surface keeps the last published value visible
 * while a refresh runs. `companion/review/invalidated` invalidates the named
 * source in the shared QueryClient.
 */
import type { RpcClient } from "@codewide/sync-client";
import type { QueryClient } from "@tanstack/react-query";

import { forgeInvalidationBus } from "./forgeInvalidationBus";
import { createForgeQueryResource, type ForgeQueryResource } from "./forgeQueryResource";
import { requireParsed } from "./forgeResources";
import {
  diffSourceKey,
  parseHunkCatalog,
  type DiffSource,
  type HunkCatalog,
} from "./reviewContract";
import { parseDrafts, type DraftsSnapshot } from "./reviewDraftContract";
import { parseGuideState, type GuideState } from "./reviewGuideContract";
import type { createWorkspaceSession } from "./workspace-session";

/** Identity of one review target on one connection. */
type ReviewSourceParams = { readonly connectionId: string; readonly source: DiffSource };
/** Identity of one hunk catalog: a source at one revision. */
type HunkParams = ReviewSourceParams & { readonly revision: string };

/** Process-lifetime review read model. */
export type ReviewResources = {
  readonly drafts: ForgeQueryResource<ReviewSourceParams, DraftsSnapshot>;
  readonly guide: ForgeQueryResource<ReviewSourceParams, GuideState>;
  readonly hunks: ForgeQueryResource<HunkParams, HunkCatalog>;
};

function sourceKey(params: ReviewSourceParams): string {
  return `${params.connectionId}\u0000${diffSourceKey(params.source)}`;
}

/** Builds the review read model over the existing session authority. */
export function createReviewResources({
  getSession,
  queryClient,
  rpcAfterAttach,
}: {
  readonly getSession: (connectionId: string) => RpcClient | undefined;
  readonly queryClient: QueryClient;
  readonly rpcAfterAttach: ReturnType<typeof createWorkspaceSession>["rpcAfterAttach"];
}): ReviewResources {
  const call = async (connectionId: string, method: string, params: unknown): Promise<unknown> => {
    const session = getSession(connectionId);
    if (session === undefined) {
      throw new Error("The server is not connected");
    }
    return rpcAfterAttach<unknown>(session, method, params);
  };
  const drafts = createForgeQueryResource<ReviewSourceParams, DraftsSnapshot>({
    client: queryClient,
    keyOf: (params) => ["review", "drafts", sourceKey(params)],
    load: async ({ connectionId, source }) =>
      requireParsed(
        parseDrafts(await call(connectionId, "companion/review/drafts/read", { source })),
        "drafts",
      ),
  });
  const guide = createForgeQueryResource<ReviewSourceParams, GuideState>({
    client: queryClient,
    keyOf: (params) => ["review", "guide", sourceKey(params)],
    load: async ({ connectionId, source }) =>
      requireParsed(
        parseGuideState(await call(connectionId, "companion/review/guide/read", { source })),
        "guide",
      ),
  });
  const hunks = createForgeQueryResource<HunkParams, HunkCatalog>({
    client: queryClient,
    keyOf: (params) => ["review", "hunks", sourceKey(params), params.revision],
    load: async ({ connectionId, revision, source }) =>
      requireParsed(
        parseHunkCatalog(
          await call(connectionId, "companion/review/hunks/read", { revision, source }),
        ),
        "hunks",
      ),
  });
  forgeInvalidationBus.subscribe((connectionId, invalidation) => {
    if (invalidation.scope !== "review") {
      return;
    }
    const key = `${connectionId}\u0000${diffSourceKey(invalidation.source)}`;
    queryClient.invalidateQueries({ queryKey: ["review", "drafts", key] }).catch(() => undefined);
    queryClient.invalidateQueries({ queryKey: ["review", "guide", key] }).catch(() => undefined);
  });
  return { drafts, guide, hunks };
}
