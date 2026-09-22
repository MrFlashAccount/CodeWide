import { startTransition, useEffect, useState } from "react";
import type { ThreadSummaryDatabase } from "../../data/thread-summary-database-contract";
import type { ThreadSummaryViewRequest } from "../../data/thread-summary-model";
import { THREAD_CATALOG_PAGE_SIZE } from "../../data/thread-catalog-loader";
import { useEvent } from "../../react/useEvent";

/** Owns demand independently of deferred React commits and duplicate native callbacks. */
class ThreadListPageRequest {
  readonly scope: string;
  private active = true;
  private limit = 0;
  private pending: Promise<boolean> | null = null;

  constructor(scope: string) {
    this.scope = scope;
  }

  retain(): () => void {
    this.active = true;
    return () => {
      this.active = false;
    };
  }

  async load(
    database: ThreadSummaryDatabase,
    request: ThreadSummaryViewRequest,
    advanceLimit: (limit: number) => void,
  ): Promise<boolean> {
    if (!this.active) {
      return false;
    }
    if (this.pending !== null) {
      return this.pending;
    }
    const operation = this.advance(database, request, advanceLimit).finally(() => {
      if (this.pending === operation) {
        this.pending = null;
      }
    });
    this.pending = operation;
    return operation;
  }

  private async advance(
    database: ThreadSummaryDatabase,
    request: ThreadSummaryViewRequest,
    advanceLimit: (limit: number) => void,
  ): Promise<boolean> {
    const base = withLimit(
      request,
      Math.max(this.limit, request.recentLimit, request.archivedLimit),
    );
    const hasNextPage = await database.ensureCatalog(base);
    if (!this.active || !hasNextPage) {
      return false;
    }
    const limit = Math.max(base.recentLimit, base.archivedLimit) + THREAD_CATALOG_PAGE_SIZE;
    const next = withLimit(base, limit);
    this.limit = limit;
    startTransition(() => {
      advanceLimit(limit);
    });
    return database.ensureCatalog(next);
  }
}

/** Advances list demand by the server continuation, independently of visible row counts. */
export function useThreadListPageRequest(
  database: ThreadSummaryDatabase | null,
  request: ThreadSummaryViewRequest | null,
  advanceLimit: (limit: number) => void,
): () => Promise<boolean> {
  const scope = requestScope(request);
  const [owner, setOwner] = useState(() => new ThreadListPageRequest(scope));
  if (owner.scope !== scope) {
    setOwner(new ThreadListPageRequest(scope));
  }
  useEffect(() => owner.retain(), [owner]);
  const loadMore = useEvent(async () =>
    database === null || request === null ? false : owner.load(database, request, advanceLimit),
  );
  return loadMore;
}

function withLimit(request: ThreadSummaryViewRequest, limit: number): ThreadSummaryViewRequest {
  if (limit === Math.max(request.recentLimit, request.archivedLimit)) {
    return request;
  }
  return request.archivedLimit > 0
    ? { ...request, archivedLimit: limit }
    : { ...request, recentLimit: limit };
}

function requestScope(request: ThreadSummaryViewRequest | null): string {
  return request === null
    ? "disabled"
    : JSON.stringify([
        request.viewId,
        request.connectionId,
        request.projectCwd,
        request.archivedLimit > 0,
      ]);
}
