import type { V2Query } from "@codewide/sync-client/v2";
import { useState, useSyncExternalStore } from "react";

import type { SavedServerId } from "../../domain/ids";
import type { QueryResourceSnapshot } from "../resources/queryResource";
import type { V2Runtime } from "../v2Runtime";

const EMPTY_QUERY_SNAPSHOT = {
  authority: "none",
  status: "loading",
  value: null,
} satisfies QueryResourceSnapshot;

export function useLiveQuery<Q extends V2Query>(
  runtime: V2Runtime,
  savedServerId: SavedServerId,
  query: Q,
): QueryResourceSnapshot<Q> {
  const [outer] = useState(() => runtime.query(savedServerId, query));
  const opened = useSyncExternalStore(outer.subscribe, outer.snapshot, outer.snapshot);
  const resource = opened.value;
  const inner = useSyncExternalStore<QueryResourceSnapshot<Q>>(
    resource?.subscribe ?? subscribeToNothing,
    resource?.snapshot ?? emptyQuerySnapshot,
    resource?.snapshot ?? emptyQuerySnapshot,
  );
  if (resource === null && opened.status === "error") {
    return {
      authority: "none",
      failure: { cause: new Error(opened.message), error: null, message: opened.message },
      message: opened.message,
      status: "error",
      value: null,
    };
  }
  return inner;
}

function subscribeToNothing(): () => void {
  return unsubscribeNothing;
}

function unsubscribeNothing(): void {}

function emptyQuerySnapshot<Q extends V2Query>(): QueryResourceSnapshot<Q> {
  return EMPTY_QUERY_SNAPSHOT;
}
