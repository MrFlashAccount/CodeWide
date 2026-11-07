export type MockRoute = {
  readonly params: Readonly<Record<string, string>>;
  readonly pathname: string;
};

export type MockHref =
  | string
  | {
      readonly params?: Readonly<Record<string, string | number>>;
      readonly pathname: string;
    };

export type MockNavigationRoute = {
  readonly key: string;
  readonly name: string;
  readonly params: Readonly<Record<string, string>>;
  readonly state?: MockNavigationState;
};

export type MockNavigationState = {
  readonly index: number;
  readonly key: string;
  readonly routes: readonly MockNavigationRoute[];
};

export type MockNavigationSnapshot = {
  readonly index: 0;
  readonly key: "app";
  readonly routes: readonly [
    {
      readonly key: "workspace";
      readonly name: "(workspace)";
      readonly state: MockNavigationState;
    },
  ];
};

export function isCatalogEntry(entry: MockRoute): boolean {
  return entry.pathname === "/" || entry.pathname === "/project/[sessionId]";
}

export function routeFromHref(href: MockHref): MockRoute {
  if (typeof href === "string") {
    return { params: {}, pathname: href };
  }
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(href.params ?? {})) {
    params[key] = String(value);
  }
  return { params, pathname: href.pathname };
}

export function isThreadsEntry(entry: MockRoute): boolean {
  return (
    isCatalogEntry(entry) ||
    entry.pathname === "/search" ||
    entry.pathname === "/projects" ||
    entry.pathname.startsWith("/projects/") ||
    entry.pathname === "/new" ||
    entry.pathname.startsWith("/new/") ||
    entry.pathname.startsWith("/threads/")
  );
}

export function isPullRequestsEntry(entry: MockRoute): boolean {
  return entry.pathname === "/pulls" || entry.pathname.startsWith("/pulls/");
}

/** Builds the minimal nested state consumed by V1 route-layout render tests. */
export function createMockNavigationSnapshot(
  history: readonly MockRoute[],
  current: MockRoute,
  keyFor: (entry: MockRoute) => string,
): MockNavigationSnapshot {
  const catalog = history.filter(isCatalogEntry);
  const catalogRoutes =
    catalog.length === 0
      ? [{ key: "initial-catalog", name: "index", params: {} }]
      : catalog.map((entry) => ({
          key: keyFor(entry),
          name: entry.pathname === "/" ? "index" : "project/[sessionId]",
          params: entry.params,
        }));
  const threadDestinations = history.filter(
    (entry) => isThreadsEntry(entry) && !isCatalogEntry(entry),
  );
  const threadRoutes: readonly MockNavigationRoute[] = [
    {
      key: "catalog",
      name: "(lists)",
      params: {},
      state: { key: "catalog-stack", index: catalogRoutes.length - 1, routes: catalogRoutes },
    },
    ...threadDestinations.map((entry) => ({
      key: keyFor(entry),
      name: entry.pathname.slice(1),
      params: entry.params,
    })),
  ];
  const pullRequestDestinations = history.filter(isPullRequestsEntry);
  const pullRequestRoutes: readonly MockNavigationRoute[] = [
    { key: "pulls-catalog", name: "pulls/index", params: {} },
    ...pullRequestDestinations
      .filter((entry) => entry.pathname !== "/pulls")
      .map((entry) => ({
        key: keyFor(entry),
        name: entry.pathname.slice(1),
        params: entry.params,
      })),
  ];
  const tabRoutes: readonly MockNavigationRoute[] = [
    {
      key: "threads",
      name: "(threads)",
      params: {},
      state: {
        key: "threads-stack",
        index: isCatalogEntry(current) ? 0 : threadRoutes.length - 1,
        routes: threadRoutes,
      },
    },
    {
      key: "pull-requests",
      name: "(pull-requests)",
      params: {},
      state: {
        key: "pull-requests-stack",
        index: isPullRequestsEntry(current) ? pullRequestRoutes.length - 1 : 0,
        routes: pullRequestRoutes,
      },
    },
  ];
  const workspaceRoutes: readonly MockNavigationRoute[] = [
    {
      key: "tabs",
      name: "(tabs)",
      params: {},
      state: {
        key: "workspace-tabs",
        index: isPullRequestsEntry(current) ? 1 : 0,
        routes: tabRoutes,
      },
    },
    ...history
      .filter((entry) => !isThreadsEntry(entry) && !isPullRequestsEntry(entry))
      .map((entry) => ({
        key: keyFor(entry),
        name: entry.pathname.slice(1),
        params: entry.params,
      })),
  ];
  return {
    key: "app",
    index: 0,
    routes: [
      {
        key: "workspace",
        name: "(workspace)",
        state: {
          key: "workspace-stack",
          index:
            isThreadsEntry(current) || isPullRequestsEntry(current) ? 0 : workspaceRoutes.length - 1,
          routes: workspaceRoutes,
        },
      },
    ],
  };
}
