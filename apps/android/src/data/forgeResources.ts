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
import { QueryClient } from "@tanstack/react-query";
import type { Persister } from "@tanstack/react-query-persist-client";
import type { RpcClient } from "@codewide/sync-client";

import { ForgeContractViolation } from "./forgeErrors";
import { parseForgeAccounts, type ForgeAccountsSnapshot } from "./forgeContract";
import { forgeInvalidationBus } from "./forgeInvalidationBus";
import {
  createForgeMutationQueue,
  registerForgeMutationDefaults,
  type ForgeMutationQueue,
} from "./forgeMutationQueue";
import { persistForgeQueryClient } from "./forgeQueryPersistence";
import { createForgeQueryResource, type ForgeQueryResource } from "./forgeQueryResource";
import { mergeListPages, type ListParams } from "./forgeListPages";
import type { OverviewParams } from "./forgeOverview";
import {
  parseActivityPage,
  parsePullRequestOverview,
  parsePullRequestListPage,
  type ActivityPage,
  type PullRequestListPage,
  type PullRequestOverview,
} from "./forgePullRequestContract";
import { parseFilesPage, type PullRequestFilesPage } from "./forgeMutationContract";
import type { createWorkspaceSession } from "./workspace-session";

/** Session access shared by every forge read. */
export type ForgeReadAuthority = {
  readonly getSession: (connectionId: string) => RpcClient | undefined;
  readonly persister: Persister;
  readonly reportDroppedAction: (actionId: string) => void;
  readonly rpcAfterAttach: ReturnType<typeof createWorkspaceSession>["rpcAfterAttach"];
};

/** Params of a files page set: the head revision is part of its identity. */
type FilesParams = OverviewParams & { readonly headRevision: string };

/** Process-lifetime forge read model. */
export type ForgeResources = {
  readonly accounts: ForgeQueryResource<{ readonly connectionId: string }, ForgeAccountsSnapshot>;
  readonly activity: ForgeQueryResource<OverviewParams, ActivityPage>;
  readonly files: ForgeQueryResource<FilesParams, PullRequestFilesPage>;
  readonly lists: ForgeQueryResource<ListParams, PullRequestListPage>;
  /** Resolves once an accounts snapshot exists (read now if none); never rejects. */
  readonly loadAccounts: (connectionId: string) => Promise<void>;
  /** Appends the next activity page, if any. */
  readonly loadMoreActivity: (params: OverviewParams) => Promise<void>;
  /** Appends the next files page, if any. */
  readonly loadMoreFiles: (params: FilesParams) => Promise<void>;
  /** Appends the next list page, if any. */
  readonly loadMoreList: (params: ListParams) => Promise<void>;
  readonly mutations: ForgeMutationQueue;
  readonly overviews: ForgeQueryResource<OverviewParams, PullRequestOverview>;
  readonly preloadOverview: (params: OverviewParams) => Promise<PullRequestOverview>;
  readonly queryClient: QueryClient;
  /** Resolves after TanStack has restored the persisted Forge/review cache. */
  readonly restored: Promise<void>;
};

/** Requires a parsed value, turning a contract mismatch into a typed failure. */
export function requireParsed<Value>(value: Value | null, method: string): Value {
  if (value === null) {
    throw new ForgeContractViolation(method);
  }
  return value;
}

/** Appends the next page of a paged resource when its last page has a cursor. */
async function appendPage<Params, Value extends { readonly nextCursor: string | null }>(
  resource: ForgeQueryResource<Params, Value>,
  params: Params,
  page: {
    readonly merge: (current: Value, next: Value) => Value;
    readonly readNext: (cursor: string) => Promise<Value>;
  },
): Promise<void> {
  const current = resource.data(params);
  if (current === null || current.nextCursor === null) {
    return;
  }
  resource.publish(params, page.merge(current, await page.readNext(current.nextCursor)));
}

/** Builds the forge read model over the existing session authority. */
export function createForgeResources(authority: ForgeReadAuthority): ForgeResources {
  const queryClient = new QueryClient();
  registerForgeMutationDefaults({
    authority: {
      getSession: authority.getSession,
      rpcAfterAttach: authority.rpcAfterAttach,
    },
    client: queryClient,
  });
  const persistence = persistForgeQueryClient(queryClient, authority.persister);
  const restored = persistence.restored;
  const mutations = createForgeMutationQueue({ client: queryClient, restored });
  const call = async (connectionId: string, method: string, params: unknown): Promise<unknown> => {
    const session = authority.getSession(connectionId);
    if (session === undefined) {
      throw new Error("The server is not connected");
    }
    return authority.rpcAfterAttach<unknown>(session, method, params);
  };
  const accounts = createForgeQueryResource<
    { readonly connectionId: string },
    ForgeAccountsSnapshot
  >({
    client: queryClient,
    keyOf: ({ connectionId }) => ["forge", "accounts", connectionId],
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
  const lists = createForgeQueryResource<ListParams, PullRequestListPage>({
    client: queryClient,
    keyOf: (params) => ["forge", "lists", params.connectionId, params.category, params.repository],
    load: async (params) => readList(params, null),
  });
  const overviews = createForgeQueryResource<OverviewParams, PullRequestOverview>({
    client: queryClient,
    keyOf: (params) => ["forge", "overview", params.connectionId, params.pullRequest],
    load: async (params) =>
      requireParsed(
        parsePullRequestOverview(
          await call(params.connectionId, "companion/pullRequest/read", {
            pullRequest: params.pullRequest,
          }),
          authority.reportDroppedAction,
        ),
        "pull request overview",
      ),
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
  const files = createForgeQueryResource<FilesParams, PullRequestFilesPage>({
    client: queryClient,
    keyOf: (params) => [
      "forge",
      "files",
      params.connectionId,
      params.pullRequest,
      params.headRevision,
    ],
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
  const activity = createForgeQueryResource<OverviewParams, ActivityPage>({
    client: queryClient,
    keyOf: (params) => ["forge", "activity", params.connectionId, params.pullRequest],
    load: async (params) => readActivity(params, null),
  });
  forgeInvalidationBus.subscribe((connectionId, invalidation) => {
    if (invalidation.scope === "accounts") {
      queryClient
        .invalidateQueries({ queryKey: ["forge", "accounts", connectionId] })
        .catch(() => undefined);
      queryClient
        .invalidateQueries({ queryKey: ["forge", "lists", connectionId] })
        .catch(() => undefined);
    } else if (invalidation.scope === "list") {
      queryClient
        .invalidateQueries({ queryKey: ["forge", "lists", connectionId] })
        .catch(() => undefined);
    } else if (invalidation.scope === "pullRequest") {
      queryClient
        .invalidateQueries({
          queryKey: ["forge", "overview", connectionId, invalidation.pullRequest],
        })
        .catch(() => undefined);
      queryClient
        .invalidateQueries({
          queryKey: ["forge", "activity", connectionId, invalidation.pullRequest],
        })
        .catch(() => undefined);
      queryClient
        .invalidateQueries({
          queryKey: ["forge", "files", connectionId, invalidation.pullRequest],
        })
        .catch(() => undefined);
    }
  });
  return {
    accounts,
    activity,
    files,
    lists,
    loadAccounts: async (connectionId) => {
      if (accounts.data({ connectionId }) === null) {
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
    mutations,
    overviews,
    preloadOverview: overviews.preload,
    queryClient,
    restored,
  };
}
