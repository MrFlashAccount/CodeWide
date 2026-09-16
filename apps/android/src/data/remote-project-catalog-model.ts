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
    loader: () => Promise<RemoteProject[]>,
  ) => Observable<boolean>;
  retain: (connectionId: string) => () => void;
  snapshot$: Observable<RemoteProjectCatalogSnapshot>;
};

type ProjectResource = {
  failed: boolean;
  generation: number;
  loader: () => Promise<RemoteProject[]>;
  loadingRevision: string | null;
  mergedWhileLoading: Map<string, RemoteProject>;
  ready$: Observable<boolean> | null;
  retryAttempt: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  revision: string;
};

/**
 * Process-wide Legend owner for the small project catalog. Promise identity,
 * stale data and refresh errors live here rather than in component lifecycle.
 */
export function createRemoteProjectCatalogModel(): RemoteProjectCatalogModel {
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
      if (resources.get(connectionId) === record && (retainCounts.get(connectionId) ?? 0) > 0) {
        beginLoad(connectionId, record.revision, record.loader, record).catch(() => false);
      }
    }, delay);
  };

  async function beginLoad(
    connectionId: string,
    revision: string,
    loader: () => Promise<RemoteProject[]>,
    record: ProjectResource,
  ): Promise<boolean> {
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
    record.mergedWhileLoading.clear();
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
        // A pin/add acknowledgement is newer than the list read already in flight.
        let resolvedProjects = projects;
        if (current.mergedWhileLoading.size > 0) {
          resolvedProjects = projects.map(
            (project) => current.mergedWhileLoading.get(project.path) ?? project,
          );
          for (const [path, project] of current.mergedWhileLoading) {
            if (!projects.some((candidate) => candidate.path === path)) {
              resolvedProjects.push(project);
            }
          }
        }
        current.mergedWhileLoading.clear();
        snapshot$.projectsByConnection.assign({ [connectionId]: resolvedProjects });
        snapshot$.errorsByConnection.assign({ [connectionId]: null });
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
    },
    resource(connectionId, revision, loader) {
      let record = resources.get(connectionId);
      if (record === undefined) {
        record = {
          failed: false,
          generation: 0,
          loader,
          loadingRevision: revision,
          mergedWhileLoading: new Map(),
          ready$: null,
          retryAttempt: 0,
          retryTimer: null,
          revision,
        };
        resources.set(connectionId, record);
        record.ready$ = observablePromise(beginLoad(connectionId, revision, loader, record));
      } else if (record.revision !== revision && record.loadingRevision !== revision) {
        // Connection reconnection is a stale-while-refresh boundary: keep the
        // last usable catalog until the replacement has completely arrived.
        beginLoad(connectionId, revision, loader, record).catch(() => false);
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

export const remoteProjectCatalogModel = createRemoteProjectCatalogModel();
