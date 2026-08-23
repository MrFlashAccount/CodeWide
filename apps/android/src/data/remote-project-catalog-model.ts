import { observable, type Observable } from "@legendapp/state";

import type { RemoteProject } from "./remote-projects";

export type RemoteProjectCatalogSnapshot = {
  projectsByConnection: Record<string, RemoteProject[]>;
  errorsByConnection: Record<string, string | null>;
};

export type RemoteProjectCatalogModel = {
  snapshot$: Observable<RemoteProjectCatalogSnapshot>;
  resource(connectionId: string, revision: string, loader: () => Promise<RemoteProject[]>): Observable<boolean>;
  retain(connectionId: string): () => void;
  mergeProject(connectionId: string, project: RemoteProject): void;
  clear(): void;
};

type ProjectResource = {
  ready$: Observable<boolean>;
  revision: string;
  loadingRevision: string | null;
  generation: number;
  failed: boolean;
  retryAttempt: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  loader: () => Promise<RemoteProject[]>;
};

/**
 * Process-wide Legend owner for the small project catalog. Promise identity,
 * stale data and refresh errors live here rather than in component lifecycle.
 */
export function createRemoteProjectCatalogModel(): RemoteProjectCatalogModel {
  const snapshot$ = observable<RemoteProjectCatalogSnapshot>({
    projectsByConnection: {},
    errorsByConnection: {},
  });
  const resources = new Map<string, ProjectResource>();
  const retainCounts = new Map<string, number>();

  const scheduleRetry = (connectionId: string, record: ProjectResource, immediate: boolean): void => {
    if (record.retryTimer !== null || record.loadingRevision !== null || (retainCounts.get(connectionId) ?? 0) === 0) return;
    const delay = immediate ? 0 : Math.min(250 * (2 ** record.retryAttempt), 5_000);
    if (!immediate) record.retryAttempt += 1;
    record.retryTimer = setTimeout(() => {
      record.retryTimer = null;
      if (resources.get(connectionId) === record && (retainCounts.get(connectionId) ?? 0) > 0) {
        void beginLoad(connectionId, record.revision, record.loader, record);
      }
    }, delay);
  };

  function beginLoad(
    connectionId: string,
    revision: string,
    loader: () => Promise<RemoteProject[]>,
    record: ProjectResource,
  ): Promise<boolean> {
    if (record.retryTimer !== null) clearTimeout(record.retryTimer);
    record.retryTimer = null;
    const generation = record.generation + 1;
    record.generation = generation;
    record.revision = revision;
    record.loadingRevision = revision;
    record.loader = loader;
    record.failed = false;
    return Promise.resolve().then(loader).then((projects) => {
      const current = resources.get(connectionId);
      if (current !== record || current.generation !== generation || current.revision !== revision) return false;
      current.loadingRevision = null;
      current.retryAttempt = 0;
      snapshot$.projectsByConnection.set({
        ...snapshot$.projectsByConnection.peek(),
        [connectionId]: projects,
      });
      snapshot$.errorsByConnection.set({
        ...snapshot$.errorsByConnection.peek(),
        [connectionId]: null,
      });
      return true;
    }).catch((cause: unknown) => {
      const current = resources.get(connectionId);
      if (current === record && current.generation === generation && current.revision === revision) {
        current.loadingRevision = null;
        current.failed = true;
        snapshot$.errorsByConnection.set({
          ...snapshot$.errorsByConnection.peek(),
          [connectionId]: cause instanceof Error ? cause.message : "Could not load projects",
        });
        scheduleRetry(connectionId, current, false);
      }
      return false;
    });
  }

  return {
    snapshot$,
    resource(connectionId, revision, loader) {
      let record = resources.get(connectionId);
      if (record === undefined) {
        record = {
          ready$: null as unknown as Observable<boolean>,
          revision,
          loadingRevision: revision,
          generation: 0,
          failed: false,
          retryAttempt: 0,
          retryTimer: null,
          loader,
        };
        resources.set(connectionId, record);
        record.ready$ = observable(beginLoad(connectionId, revision, loader, record)) as unknown as Observable<boolean>;
      } else if (record.revision !== revision && record.loadingRevision !== revision) {
        // Connection reconnection is a stale-while-refresh boundary: keep the
        // last usable catalog until the replacement has completely arrived.
        void beginLoad(connectionId, revision, loader, record);
      }
      return record.ready$;
    },
    retain(connectionId) {
      retainCounts.set(connectionId, (retainCounts.get(connectionId) ?? 0) + 1);
      const record = resources.get(connectionId);
      if (record?.failed === true) scheduleRetry(connectionId, record, true);
      let retained = true;
      return () => {
        if (!retained) return;
        retained = false;
        const next = (retainCounts.get(connectionId) ?? 1) - 1;
        if (next <= 0) {
          retainCounts.delete(connectionId);
          const current = resources.get(connectionId);
          if (current?.retryTimer !== null && current?.retryTimer !== undefined) clearTimeout(current.retryTimer);
          if (current !== undefined) current.retryTimer = null;
        } else {
          retainCounts.set(connectionId, next);
        }
      };
    },
    mergeProject(connectionId, project) {
      const projectsByConnection = snapshot$.projectsByConnection.peek();
      const existing = projectsByConnection[connectionId] ?? [];
      snapshot$.projectsByConnection.set({
        ...projectsByConnection,
        [connectionId]: [
          project,
          ...existing.filter((candidate) => candidate.path !== project.path),
        ],
      });
      snapshot$.errorsByConnection.set({
        ...snapshot$.errorsByConnection.peek(),
        [connectionId]: null,
      });
    },
    clear() {
      for (const resource of resources.values()) {
        if (resource.retryTimer !== null) clearTimeout(resource.retryTimer);
      }
      resources.clear();
      retainCounts.clear();
      snapshot$.set({ projectsByConnection: {}, errorsByConnection: {} });
    },
  };
}

export const remoteProjectCatalogModel = createRemoteProjectCatalogModel();
