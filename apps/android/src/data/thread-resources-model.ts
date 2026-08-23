import { observable, type Observable } from "@legendapp/state";

import { replaceEqualDeep } from "./replace-equal-deep";
import type { ThreadResourcesRow } from "./workspace-resource-database";

export type ThreadResourcesModel = {
  row$(id: string): Observable<ThreadResourcesRow | null>;
  resource(id: string, revision: string, loader: () => Promise<unknown>): Observable<boolean>;
  retain(id: string): () => void;
  get(id: string): ThreadResourcesRow | undefined;
  put(row: ThreadResourcesRow): void;
  delete(id: string): void;
  close(): void;
};

export function createThreadResourcesModel(maxResidentRows = 48): ThreadResourcesModel {
  const rows = new Map<string, Observable<ThreadResourcesRow | null>>();
  const retainCounts = new Map<string, number>();
  const resources = new Map<string, { ready$: Observable<boolean>; revision: string; loadingRevision: string | null; token: number }>();
  let closed = false;

  const row$ = (id: string): Observable<ThreadResourcesRow | null> => {
    let node = rows.get(id);
    if (node === undefined) {
      node = observable<ThreadResourcesRow | null>(null);
      rows.set(id, node);
    }
    return node;
  };

  const prune = (): void => {
    const resident = [...rows]
      .flatMap(([id, node]) => {
        const row = node.peek();
        return row === null || (retainCounts.get(id) ?? 0) > 0 ? [] : [{ id, updatedAt: row.updatedAt }];
      })
      .sort((left, right) => left.updatedAt - right.updatedAt);
    const residentCount = [...rows.values()].filter((node) => node.peek() !== null).length;
    const overflow = resident.slice(0, Math.max(0, residentCount - maxResidentRows));
    for (const { id } of overflow) {
      rows.get(id)?.set(null);
      rows.delete(id);
      resources.delete(id);
    }
  };

  const beginLoad = (id: string, revision: string, loader: () => Promise<unknown>, record: { ready$: Observable<boolean>; revision: string; loadingRevision: string | null; token: number }): Promise<boolean> => {
    const token = record.token + 1;
    record.token = token;
    record.revision = revision;
    record.loadingRevision = revision;
    // Resource discovery happens during render. Start the operation after the
    // current stack so a loader that publishes a loading row cannot mutate an
    // external store in the middle of React rendering.
    const operation = Promise.resolve().then(loader);
    return operation.then(() => {
      const current = resources.get(id);
      if (closed || current === undefined || current.token !== token || current.revision !== revision) return false;
      current.loadingRevision = null;
      return true;
    }).catch((cause: unknown) => {
      const current = resources.get(id);
      if (!closed && current !== undefined && current.token === token && current.revision === revision) current.loadingRevision = null;
      throw cause;
    });
  };

  return {
    row$,
    resource(id, revision, loader) {
      if (closed) throw new Error("Thread resources model is closed");
      let record = resources.get(id);
      if (record === undefined) {
        record = { ready$: null as unknown as Observable<boolean>, revision, loadingRevision: revision, token: 0 };
        resources.set(id, record);
        record.ready$ = observable(beginLoad(id, revision, loader, record)) as unknown as Observable<boolean>;
      } else if (record.revision !== revision && record.loadingRevision !== revision) {
        void beginLoad(id, revision, loader, record).catch(() => {
          // The loader publishes its scoped error row. Keep the stale value;
          // an explicit refresh or connection revision owns the next attempt.
        });
      }
      return record.ready$;
    },
    retain(id) {
      if (closed) return () => undefined;
      retainCounts.set(id, (retainCounts.get(id) ?? 0) + 1);
      let retained = true;
      return () => {
        if (!retained) return;
        retained = false;
        const next = (retainCounts.get(id) ?? 1) - 1;
        if (next <= 0) retainCounts.delete(id);
        else retainCounts.set(id, next);
        prune();
      };
    },
    get(id) {
      return rows.get(id)?.peek() ?? undefined;
    },
    put(row) {
      if (closed) return;
      const node = row$(row.id);
      const previous = node.peek();
      node.set(previous === null ? row : replaceEqualDeep(previous, row));
      prune();
    },
    delete(id) {
      rows.get(id)?.set(null);
      rows.delete(id);
      resources.delete(id);
    },
    close() {
      closed = true;
      for (const node of rows.values()) node.set(null);
      rows.clear();
      resources.clear();
      retainCounts.clear();
    },
  };
}
