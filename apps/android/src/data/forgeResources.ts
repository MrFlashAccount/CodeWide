/**
 * The single owner of forge Promise identity and request deduplication:
 * accounts (availability), list pages, the atomic PR overview, file and
 * activity pages, plus the invalidation subscription.
 *
 * `preloadOverview` returns the same cached Promise the PR screen reads with
 * Suspense, so navigation reveals the screen only after its snapshot exists.
 * Mutations live with their feature adapters and publish acknowledged results
 * back through `publish*`. No component or route session keeps a second copy.
 */
import type { Observable } from "@legendapp/state";
import type { RpcClient } from "@codewide/sync-client";

import { ForgeContractViolation } from "./forgeErrors";
import { parseForgeAccounts, type ForgeAccountsSnapshot } from "./forgeContract";
import { forgeInvalidationBus } from "./forgeInvalidationBus";
import { createKeyedResource, type KeyedResource } from "./forgeKeyedResource";
import { mergeListPages, type ListParams } from "./forgeListPages";
import {
  createOverviewPromises,
  type OverviewParams,
  type OverviewPromises,
} from "./forgeOverviewPromises";
import {
  parseActivityPage,
  parsePullRequestListPage,
  type ActivityPage,
  type PullRequestListPage,
  type PullRequestOverview,
} from "./forgePullRequestContract";
import { parseFilesPage, type PullRequestFilesPage } from "./forgeMutationContract";
import type { ForgeSnapshotCache } from "./forgeSnapshotCache.types";
import type { createWorkspaceSession } from "./workspace-session";

/** Session access shared by every forge read. */
export type ForgeReadAuthority = {
  readonly getSession: (connectionId: string) => RpcClient | undefined;
  readonly reportDroppedAction: (actionId: string) => void;
  readonly rpcAfterAttach: ReturnType<typeof createWorkspaceSession>["rpcAfterAttach"];
  readonly snapshots: ForgeSnapshotCache;
};

/** Params of a files page set: the head revision is part of its identity. */
type FilesParams = OverviewParams & { readonly headRevision: string };

/** Process-lifetime forge read model. */
export type ForgeResources = {
  readonly accounts: KeyedResource<{ readonly connectionId: string }, ForgeAccountsSnapshot>;
  readonly activity: KeyedResource<OverviewParams, ActivityPage>;
  readonly files: KeyedResource<FilesParams, PullRequestFilesPage>;
  readonly lists: KeyedResource<ListParams, PullRequestListPage>;
  /** Resolves once an accounts snapshot exists (read now if none); never rejects. */
  readonly loadAccounts: (connectionId: string) => Promise<void>;
  /** Appends the next activity page, if any. */
  readonly loadMoreActivity: (params: OverviewParams) => Promise<void>;
  /** Appends the next files page, if any. */
  readonly loadMoreFiles: (params: FilesParams) => Promise<void>;
  /** Appends the next list page, if any. */
  readonly loadMoreList: (params: ListParams) => Promise<void>;
  /** Suspense handle of the cached overview Promise (same identity as `preloadOverview`). */
  readonly overviewReady$: (params: OverviewParams) => Observable<PullRequestOverview>;
  readonly overviews: OverviewPromises;
  readonly preloadOverview: (params: OverviewParams) => Promise<PullRequestOverview>;
};

/** Requires a parsed value, turning a contract mismatch into a typed failure. */
export function requireParsed<Value>(value: Value | null, method: string): Value {
  if (value === null) {
    throw new ForgeContractViolation(method);
  }
  return value;
}

/** Every list of a connection is affected by an accounts or list invalidation. */
function everyList(): boolean {
  return true;
}

function listKey(params: ListParams): string {
  return `list\u0000${params.category}\u0000${params.repository ?? ""}`;
}

/** Appends the next page of a paged resource when its last page has a cursor. */
async function appendPage<Params, Value extends { readonly nextCursor: string | null }>(
  resource: KeyedResource<Params, Value>,
  params: Params,
  page: {
    readonly merge: (current: Value, next: Value) => Value;
    readonly readNext: (cursor: string) => Promise<Value>;
  },
): Promise<void> {
  const current = resource.state$[resource.keyOf(params)]?.peek();
  if (current?.status !== "ready" || current.value.nextCursor === null) {
    return;
  }
  resource.publish(
    params,
    page.merge(current.value, await page.readNext(current.value.nextCursor)),
  );
}

/** Re-reads every demanded entry of one connection that matches an invalidation. */
function revalidateMatching<Params extends { readonly connectionId: string }, Value>(
  resource: KeyedResource<Params, Value>,
  connectionId: string,
  matches: (params: Params) => boolean,
): void {
  for (const params of resource.loaded()) {
    if (params.connectionId === connectionId && matches(params)) {
      resource.revalidate(params);
    }
  }
}

/** Builds the forge read model over the existing session authority. */
export function createForgeResources(authority: ForgeReadAuthority): ForgeResources {
  const call = async (connectionId: string, method: string, params: unknown): Promise<unknown> => {
    const session = authority.getSession(connectionId);
    if (session === undefined) {
      throw new Error("The server is not connected");
    }
    return authority.rpcAfterAttach<unknown>(session, method, params);
  };
  const accounts = createKeyedResource<{ readonly connectionId: string }, ForgeAccountsSnapshot>({
    keyOf: ({ connectionId }) => connectionId,
    load: async ({ connectionId }) =>
      requireParsed(
        parseForgeAccounts(await call(connectionId, "companion/forge/accounts/read", {})),
        "accounts",
      ),
  });
  const readList = async (
    params: ListParams,
    cursor: string | null,
  ): Promise<PullRequestListPage> =>
    requireParsed(
      parsePullRequestListPage(
        await call(params.connectionId, "companion/pullRequests/list", {
          category: params.category,
          cursor,
          repository: params.repository,
        }),
      ),
      "pull request list",
    );
  const lists = createKeyedResource<ListParams, PullRequestListPage>({
    fallback: async (params) =>
      parsePullRequestListPage(
        await authority.snapshots.read(params.connectionId, listKey(params)),
      ),
    keyOf: (params) => `${params.connectionId}\u0000${listKey(params)}`,
    load: async (params) => readList(params, null),
    onLoaded: (params, page) => {
      // The snapshot is a best-effort offline copy; a failed write keeps the previous one.
      authority.snapshots.write(params.connectionId, listKey(params), page).catch(() => undefined);
    },
  });
  const overviews = createOverviewPromises({
    load: async ({ connectionId, pullRequest }) =>
      call(connectionId, "companion/pullRequest/read", { pullRequest }),
    reportDroppedAction: authority.reportDroppedAction,
    snapshots: authority.snapshots,
  });
  const readFiles = async (params: FilesParams, cursor: string | null) =>
    requireParsed(
      parseFilesPage(
        await call(params.connectionId, "companion/pullRequest/files/read", {
          cursor,
          headRevision: params.headRevision,
          pullRequest: params.pullRequest,
        }),
      ),
      "files page",
    );
  const files = createKeyedResource<FilesParams, PullRequestFilesPage>({
    keyOf: (params) =>
      `${params.connectionId}\u0000${params.pullRequest}\u0000${params.headRevision}`,
    load: async (params) => readFiles(params, null),
  });
  const readActivity = async (params: OverviewParams, cursor: string | null) =>
    requireParsed(
      parseActivityPage(
        await call(params.connectionId, "companion/pullRequest/activity/read", {
          cursor,
          pullRequest: params.pullRequest,
        }),
      ),
      "activity page",
    );
  const activity = createKeyedResource<OverviewParams, ActivityPage>({
    keyOf: (params) => `${params.connectionId}\u0000${params.pullRequest}`,
    load: async (params) => readActivity(params, null),
  });
  forgeInvalidationBus.subscribe((connectionId, invalidation) => {
    if (invalidation.scope === "accounts") {
      accounts.revalidate({ connectionId });
      revalidateMatching(lists, connectionId, everyList);
    } else if (invalidation.scope === "list") {
      revalidateMatching(lists, connectionId, everyList);
    } else if (invalidation.scope === "pullRequest") {
      const matches = (params: OverviewParams): boolean =>
        params.pullRequest === invalidation.pullRequest;
      overviews.refreshMatching(connectionId, invalidation.pullRequest);
      revalidateMatching(activity, connectionId, matches);
      revalidateMatching(files, connectionId, matches);
    }
  });
  return {
    accounts,
    activity,
    files,
    lists,
    loadAccounts: async (connectionId) => {
      if (accounts.state$.peek()[connectionId]?.status !== "ready") {
        await accounts.refresh({ connectionId });
      }
    },
    loadMoreActivity: async (params) =>
      appendPage(activity, params, {
        merge: (current, next) => ({
          items: [...current.items, ...next.items],
          nextCursor: next.nextCursor,
        }),
        readNext: async (cursor) => readActivity(params, cursor),
      }),
    loadMoreFiles: async (params) =>
      appendPage(files, params, {
        merge: (current, next) => ({ ...next, files: [...current.files, ...next.files] }),
        readNext: async (cursor) => readFiles(params, cursor),
      }),
    loadMoreList: async (params) =>
      appendPage(lists, params, {
        merge: mergeListPages,
        readNext: async (cursor) => readList(params, cursor),
      }),
    overviewReady$: overviews.ready$,
    overviews,
    preloadOverview: overviews.preload,
  };
}
