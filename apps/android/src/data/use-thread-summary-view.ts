import { useSelector } from "@legendapp/state/react";
import { useEffect } from "react";

import type { ThreadSummaryDatabase } from "./thread-summary-database";
import type { ThreadSummaryViewRequest, ThreadSummaryViewSnapshot } from "./thread-summary-model";

export function useThreadSummaryView(
  database: ThreadSummaryDatabase | null,
  request: ThreadSummaryViewRequest | null,
): ThreadSummaryViewSnapshot | null {
  const enabled = request !== null;
  const viewId = request?.viewId;
  const connectionId = request?.connectionId ?? null;
  const recentLimit = request?.recentLimit ?? 0;
  const archivedLimit = request?.archivedLimit ?? 0;
  const selectedConnectionId = request?.selectedConnectionId ?? null;
  const selectedThreadId = request?.selectedThreadId ?? null;
  const subagentConnectionId = request?.subagentConnectionId ?? null;
  const subagentLimit = request?.subagentLimit ?? 0;
  const resource = database === null || !enabled ? null : database.viewResource({
    ...(viewId === undefined ? {} : { viewId }),
    connectionId,
    recentLimit,
    archivedLimit,
    selectedConnectionId,
    selectedThreadId,
    subagentConnectionId,
    subagentLimit,
  });
  useEffect(() => {
    if (database === null || !enabled) return;
    return database.model.retainView({
      ...(viewId === undefined ? {} : { viewId }),
      connectionId,
    });
  }, [connectionId, database, enabled, viewId]);

  return useSelector(() => {
    if (resource === null) return null;
    resource.ready$.get();
    return resource.view$.get();
  }, { suspense: true });
}
