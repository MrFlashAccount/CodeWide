import { observable, type Observable } from "@legendapp/state";

import type { RemoteProject } from "./remote-projects";
import { observablePromise } from "./observablePromise";

type RemoteProjectCatalogSnapshot = {
  errorsByConnection: Record<string, string | null>;
  projectsByConnection: Record<string, RemoteProject[]>;
};

export type RemoteProjectCatalogModel = {
  clear: () => void;
  mergeProject: (connectionId: string, project: RemoteProject) => void;
  resource: (
    connectionId: string,
    revision: string,
    loader: (() => Promise<RemoteProject[]>) | null,
  ) => Observable<boolean>;
  retain: (connectionId: string) => () => void;
  snapshot$: Observable<RemoteProjectCatalogSnapshot>;
};

type ProjectResource = {
  authoritativeGeneration: number | null;
  failed: boolean;
  generation: number;
  loader: (() => Promise<RemoteProject[]>) | null;
  loadingRevision: string | null;
  mergedWhileLoading: Map<string, RemoteProject>;
  ready$: Observable<boolean> | null;
  retryAttempt: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  revision: string;
};

type RemoteProjectCatalogCache = {
  read: (connectionId: string) => Promise<RemoteProject[]>;
  write: (connectionId: string, projects: readonly RemoteProject[]) => Promise<void>;
};

export type RemoteProjectCatalogModelOptions = {
  cache?: RemoteProjectCatalogCache;
};

type ProjectLoadInput = {
  connectionId: string;
  loader: () => Promise<RemoteProject[]>;
  record: ProjectResource;
  revision: string;
};

type ProjectHydrationInput = {
  connectionId: string;
  record: ProjectResource;
};

type ProjectDemandInput = {
  connectionId: string;
  loader: (() => Promise<RemoteProject[]>) | null;
  record: ProjectResource;
  revision: string;
};

function mergeAcknowledgedProjects(
  projects: RemoteProject[],
  acknowledged: ReadonlyMap<string, RemoteProject>,
): RemoteProject[] {
  if (acknowledged.size === 0) {
    return projects;
  }
  const resolved = projects.map((project) => acknowledged.get(project.path) ?? project);
  for (const [path, project] of acknowledged) {
    if (!projects.some((candidate) => candidate.path === path)) {
      resolved.push(project);
    }
  }
  return resolved;
}

/**
 * Process-wide Legend owner for the small project catalog. Promise identity,
 * stale data and refresh errors live here rather than in component lifecycle.
 */
export function createRemoteProjectCatalogModel(
  options: RemoteProjectCatalogModelOptions = {},
): RemoteProjectCatalogModel {
  const snapshot$ = observable<RemoteProjectCatalogSnapshot>({
    errorsByConnection: {},
    projectsByConnection: {},
  });
  const resources = new Map<string, ProjectResource>();
  const retainCounts = new Map<string, number>();

  const scheduleRetry = (
    connectionId: string,
    record: ProjectResource,
    immediate: boolean,
  ): void => {
    if (
      record.retryTimer !== null ||
      record.loadingRevision !== null ||
      record.loader === null ||
      (retainCounts.get(connectionId) ?? 0) === 0
    ) {
      return;
    }
    const delay = immediate ? 0 : Math.min(250 * 2 ** record.retryAttempt, 5000);
    if (!immediate) {
      record.retryAttempt += 1;
    }
    record.retryTimer = setTimeout(() => {
      record.retryTimer = null;
      const loader = record.loader;
      if (
        loader !== null &&
        resources.get(connectionId) === record &&
        (retainCounts.get(connectionId) ?? 0) > 0
      ) {
        beginLoad({ connectionId, loader, record, revision: record.revision }).catch(() => false);
      }
    }, delay);
  };

  const persistProjects = (connectionId: string, projects: readonly RemoteProject[]): void => {
    options.cache?.write(connectionId, projects).catch(() => undefined);
  };

  async function beginLoad({
    connectionId,
    loader,
    record,
    revision,
  }: ProjectLoadInput): Promise<boolean> {
    if (record.retryTimer !== null) {
      clearTimeout(record.retryTimer);
    }
    record.retryTimer = null;
    const generation = record.generation + 1;
    record.generation = generation;
    record.revision = revision;
    record.loadingRevision = revision;
    record.loader = loader;
    record.failed = false;
    return Promise.resolve()
      .then(loader)
      .then((projects) => {
        const current = resources.get(connectionId);
        if (
          current !== record ||
          current.generation !== generation ||
          current.revision !== revision
        ) {
          return false;
        }
        current.loadingRevision = null;
        current.retryAttempt = 0;
        current.authoritativeGeneration = generation;
        // A pin/add acknowledgement is newer than the list read already in flight.
        const resolvedProjects = mergeAcknowledgedProjects(projects, current.mergedWhileLoading);
        current.mergedWhileLoading.clear();
        snapshot$.projectsByConnection.assign({ [connectionId]: resolvedProjects });
        snapshot$.errorsByConnection.assign({ [connectionId]: null });
        persistProjects(connectionId, resolvedProjects);
        return true;
      })
      .catch((error: unknown) => {
        const current = resources.get(connectionId);
        if (
          current === record &&
          current.generation === generation &&
          current.revision === revision
        ) {
          current.loadingRevision = null;
          current.failed = true;
          snapshot$.errorsByConnection.assign({
            [connectionId]: error instanceof Error ? error.message : "Could not load projects",
          });
          scheduleRetry(connectionId, current, false);
        }
        return false;
      });
  }

  const hydrateCache = async ({
    connectionId,
    record,
  }: ProjectHydrationInput): Promise<boolean> => {
    const cached = (await options.cache?.read(connectionId).catch(() => [])) ?? [];
    if (resources.get(connectionId) !== record) {
      return false;
    }
    if (cached.length > 0 && record.authoritativeGeneration === null) {
      snapshot$.projectsByConnection.assign({
        [connectionId]: mergeAcknowledgedProjects(cached, record.mergedWhileLoading),
      });
    }
    if (record.loadingRevision === "cache") {
      record.loadingRevision = null;
    }
    return cached.length > 0;
  };

  const beginInitialDemand = async (
    connectionId: string,
    revision: string,
    loader: (() => Promise<RemoteProject[]>) | null,
    record: ProjectResource,
  ): Promise<boolean> => {
    const cacheHydration = hydrateCache({ connectionId, record });
    const refresh =
      loader === null
        ? Promise.resolve(false)
        : beginLoad({ connectionId, loader, record, revision });
    const [cacheReady, refreshReady] = await Promise.all([cacheHydration, refresh]);
    return cacheReady || refreshReady;
  };

  const updateResourceDemand = ({
    connectionId,
    loader,
    record,
    revision,
  }: ProjectDemandInput): void => {
    if (loader === null) {
      // A connecting/offline phase keeps the last catalog and lets an
      // already-started authoritative refresh settle. It only disables
      // retries until this connection can serve RPC again.
      record.loader = null;
      return;
    }
    if (
      record.loader !== null &&
      (record.revision === revision || record.loadingRevision === revision)
    ) {
      return;
    }
    // Connection reconnection is a stale-while-refresh boundary: keep the
    // last usable catalog until the replacement has completely arrived.
    record.revision = revision;
    record.loader = loader;
    beginLoad({ connectionId, loader, record, revision }).catch(() => false);
  };

  return {
    clear() {
      for (const resource of resources.values()) {
        if (resource.retryTimer !== null) {
          clearTimeout(resource.retryTimer);
        }
      }
      resources.clear();
      retainCounts.clear();
      snapshot$.set({ errorsByConnection: {}, projectsByConnection: {} });
    },
    mergeProject(connectionId, project) {
      const resource = resources.get(connectionId);
      if (resource !== undefined && resource.loadingRevision !== null) {
        resource.mergedWhileLoading.set(project.path, project);
      }
      const existing = snapshot$.projectsByConnection.peek()[connectionId] ?? [];
      snapshot$.projectsByConnection.assign({
        [connectionId]: [
          project,
          ...existing.filter((candidate) => candidate.path !== project.path),
        ],
      });
      snapshot$.errorsByConnection.assign({ [connectionId]: null });
      persistProjects(connectionId, snapshot$.projectsByConnection.peek()[connectionId] ?? []);
    },
    resource(connectionId, revision, loader) {
      let record = resources.get(connectionId);
      if (record === undefined) {
        record = {
          authoritativeGeneration: null,
          failed: false,
          generation: 0,
          loader,
          loadingRevision: "cache",
          mergedWhileLoading: new Map(),
          ready$: null,
          retryAttempt: 0,
          retryTimer: null,
          revision,
        };
        resources.set(connectionId, record);
        record.ready$ = observablePromise(
          beginInitialDemand(connectionId, revision, loader, record),
        );
      } else {
        updateResourceDemand({ connectionId, loader, record, revision });
      }
      if (record.ready$ === null) {
        throw new Error("Project catalog readiness was not initialized");
      }
      return record.ready$;
    },
    retain(connectionId) {
      retainCounts.set(connectionId, (retainCounts.get(connectionId) ?? 0) + 1);
      const record = resources.get(connectionId);
      if (record?.failed === true) {
        scheduleRetry(connectionId, record, true);
      }
      let retained = true;
      return () => {
        if (!retained) {
          return;
        }
        retained = false;
        const next = (retainCounts.get(connectionId) ?? 1) - 1;
        if (next <= 0) {
          retainCounts.delete(connectionId);
          const current = resources.get(connectionId);
          if (current?.retryTimer !== null && current?.retryTimer !== undefined) {
            clearTimeout(current.retryTimer);
          }
          if (current !== undefined) {
            current.retryTimer = null;
          }
        } else {
          retainCounts.set(connectionId, next);
        }
      };
    },
    snapshot$,
  };
}
