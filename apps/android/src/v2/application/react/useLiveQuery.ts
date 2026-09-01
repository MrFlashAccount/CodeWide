import type { V2Query, V2QueryResult } from "@codewide/sync-client/v2";
import { useState, useSyncExternalStore } from "react";

import type { SavedServerId } from "../../domain/ids";
import type { ResourceSnapshot } from "../resources/resource";
import type { V2Runtime } from "../v2Runtime";

const EMPTY_QUERY_SNAPSHOT: ResourceSnapshot<V2QueryResult | null> = {
  status: "loading",
  value: null,
};

export function useLiveQuery(
  runtime: V2Runtime,
  savedServerId: SavedServerId,
  query: V2Query,
): ResourceSnapshot<V2QueryResult | null> {
  const [outer] = useState(() => runtime.query(savedServerId, query));
  const opened = useSyncExternalStore(outer.subscribe, outer.snapshot, outer.snapshot);
  const resource = opened.value;
  return useSyncExternalStore(
    resource?.subscribe ?? subscribeToNothing,
    resource?.snapshot ?? emptyQuerySnapshot,
    resource?.snapshot ?? emptyQuerySnapshot,
  );
}

function subscribeToNothing(): () => void {
  return unsubscribeNothing;
}

function unsubscribeNothing(): void {}

function emptyQuerySnapshot(): ResourceSnapshot<V2QueryResult | null> {
  return EMPTY_QUERY_SNAPSHOT;
}
