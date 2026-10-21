/**
 * Drafts, guide state and hunk catalogs keyed by diff source. These are
 * progressive resources: each surface reads its Legend snapshot and keeps the
 * last published value visible while a refresh runs. `companion/review/invalidated`
 * re-reads every demanded resource of the named source.
 */
import type { RpcClient } from "@codewide/sync-client";

import { forgeInvalidationBus } from "./forgeInvalidationBus";
import { createKeyedResource, type KeyedResource } from "./forgeKeyedResource";
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
  readonly drafts: KeyedResource<ReviewSourceParams, DraftsSnapshot>;
  readonly guide: KeyedResource<ReviewSourceParams, GuideState>;
  readonly hunks: KeyedResource<HunkParams, HunkCatalog>;
};

function sourceKey(params: ReviewSourceParams): string {
  return `${params.connectionId}\u0000${diffSourceKey(params.source)}`;
}

/** Builds the review read model over the existing session authority. */
export function createReviewResources({
  getSession,
  rpcAfterAttach,
}: {
  readonly getSession: (connectionId: string) => RpcClient | undefined;
  readonly rpcAfterAttach: ReturnType<typeof createWorkspaceSession>["rpcAfterAttach"];
}): ReviewResources {
  const call = async (connectionId: string, method: string, params: unknown): Promise<unknown> => {
    const session = getSession(connectionId);
    if (session === undefined) {
      throw new Error("The server is not connected");
    }
    return rpcAfterAttach<unknown>(session, method, params);
  };
  const drafts = createKeyedResource<ReviewSourceParams, DraftsSnapshot>({
    keyOf: sourceKey,
    load: async ({ connectionId, source }) =>
      requireParsed(
        parseDrafts(await call(connectionId, "companion/review/drafts/read", { source })),
        "drafts",
      ),
  });
  const guide = createKeyedResource<ReviewSourceParams, GuideState>({
    keyOf: sourceKey,
    load: async ({ connectionId, source }) =>
      requireParsed(
        parseGuideState(await call(connectionId, "companion/review/guide/read", { source })),
        "guide",
      ),
  });
  const hunks = createKeyedResource<HunkParams, HunkCatalog>({
    keyOf: (params) => `${sourceKey(params)}\u0000${params.revision}`,
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
    const key = diffSourceKey(invalidation.source);
    for (const resource of [drafts, guide]) {
      for (const params of resource.loaded()) {
        if (params.connectionId === connectionId && diffSourceKey(params.source) === key) {
          resource.revalidate(params);
        }
      }
    }
  });
  return { drafts, guide, hunks };
}
