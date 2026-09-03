import type { V2Command, V2QueryResult } from "@codewide/sync-client/v2";
import { useState, useSyncExternalStore, type ReactNode } from "react";

import { useEvent } from "../../../react/useEvent";
import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import type { QueryResourceSnapshot } from "../../application/resources/queryResource";
import type { SavedServerId } from "../../domain/ids";
import type {
  QueuePagingModel,
  QueueRowActions,
  QueueRowModel,
} from "../../presentation/queue/queueTypes";
import { QueueStatusView } from "../../presentation/queue/QueueStatusView";
import { QueueActions } from "./queueActions";
import { queueRows } from "./queueModel";

export interface QueueFeatureBoundaryProps {
  activeTurnId: string | null;
  children(model: QueueFeatureModel): ReactNode;
  mutationsEnabled?: boolean;
  savedServerId: SavedServerId;
  threadId: string;
}

interface LoadedQueueProps extends QueueFeatureBoundaryProps {
  actionable: boolean;
  status: { message: string; tone: "danger" | "muted" } | null;
  onRefresh(): Promise<void>;
  onLoadMore(): Promise<void>;
  result: Extract<V2QueryResult, { kind: "queue.list" }>;
  snapshot: QueryResourceSnapshot;
}

export interface QueueFeatureModel {
  actions: QueueRowActions;
  actionable: boolean;
  items: QueueRowModel[];
  paging: QueuePagingModel;
  refresh(): Promise<void>;
}

/** Reads and mutates only the authoritative Companion queue for one thread. */
export function QueueFeatureBoundary(props: QueueFeatureBoundaryProps): React.JSX.Element {
  const { savedServerId, threadId } = props;
  return <KeyedQueueFeatureBoundary key={`${savedServerId}:${threadId}`} {...props} />;
}

function KeyedQueueFeatureBoundary(props: QueueFeatureBoundaryProps): React.JSX.Element | null {
  const { activeTurnId, children, mutationsEnabled = true, savedServerId, threadId } = props;
  const runtime = useV2Runtime();
  const [outer] = useState(() =>
    runtime.query(savedServerId, { cursor: null, kind: "queue.list", limit: 100, threadId }),
  );
  const opened = useSyncExternalStore(outer.subscribe, outer.snapshot, outer.snapshot);
  const resource = opened.value;
  const snapshot = useSyncExternalStore(
    resource?.subscribe ?? subscribeToNothing,
    resource?.snapshot ?? emptyQueueSnapshot,
    resource?.snapshot ?? emptyQueueSnapshot,
  );
  const refresh = useEvent(() => resource?.refresh() ?? Promise.resolve());
  const loadMore = useEvent(() => resource?.loadMore() ?? Promise.resolve());
  if (resource === null) {
    return opened.status === "error" ? <QueueStatusView message={opened.message} /> : null;
  }
  if (snapshot.value === null) {
    return snapshot.status === "error" ? <QueueStatusView message={snapshot.message} /> : null;
  }
  if (snapshot.value.kind !== "queue.list") {
    return <QueueStatusView message="The server returned an unexpected queue response" />;
  }
  return (
    <LoadedQueue
      actionable={mutationsEnabled && snapshot.authority === "live"}
      activeTurnId={activeTurnId}
      onRefresh={refresh}
      onLoadMore={loadMore}
      result={snapshot.value}
      savedServerId={savedServerId}
      status={queueStatus(snapshot)}
      snapshot={snapshot}
      threadId={threadId}
    >
      {children}
    </LoadedQueue>
  );
}

function LoadedQueue(props: LoadedQueueProps): React.JSX.Element {
  const {
    actionable,
    activeTurnId,
    children,
    onLoadMore,
    onRefresh,
    result,
    savedServerId,
    snapshot,
    status,
  } = props;
  const runtime = useV2Runtime();
  const getActiveTurnId = useEvent(() => activeTurnId);
  const execute = useEvent((command: V2Command) =>
    runtime.commandActivations.execute(savedServerId, command),
  );
  const getItems = useEvent(() => result.items);
  const getRevision = useEvent(() => result.revision);
  const refresh = useEvent(() => onRefresh());
  const loadMore = useEvent(() => onLoadMore());
  const actions = new QueueActions({
    actionable: () => actionable,
    activeTurnId: getActiveTurnId,
    execute,
    items: getItems,
    refresh,
    revision: getRevision,
  });
  return (
    <>
      {children({
        actionable,
        actions,
        items: queueRows(result.items),
        paging: queuePaging(snapshot, result, loadMore),
        refresh,
      })}
      {status === null ? null : <QueueStatusView message={status.message} tone={status.tone} />}
    </>
  );
}

const EMPTY_QUEUE_SNAPSHOT: QueryResourceSnapshot = {
  authority: "none",
  status: "loading",
  value: null,
};

function subscribeToNothing(): () => void {
  return unsubscribeNothing;
}

function unsubscribeNothing(): void {}

function emptyQueueSnapshot(): QueryResourceSnapshot {
  return EMPTY_QUEUE_SNAPSHOT;
}

function queueStatus(
  snapshot: QueryResourceSnapshot,
): { message: string; tone: "danger" | "muted" } | null {
  if (snapshot.authority === "live") return null;
  if (snapshot.status === "error") return { message: snapshot.message, tone: "danger" };
  return { message: "Refreshing queued prompts…", tone: "muted" };
}

function queuePaging(
  snapshot: QueryResourceSnapshot,
  result: Extract<V2QueryResult, { kind: "queue.list" }>,
  loadMore: () => Promise<void>,
): QueuePagingModel {
  if (result.nextCursor === null) return { loadMore, status: "complete" };
  if (snapshot.operation === "loadMore") {
    return snapshot.status === "error"
      ? { loadMore, message: snapshot.message, status: "error" }
      : { loadMore, status: "loading" };
  }
  return snapshot.authority === "live"
    ? { loadMore, status: "ready" }
    : { loadMore, status: "unavailable" };
}
