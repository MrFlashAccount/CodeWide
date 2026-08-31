import type { V2Query, V2QueryResult } from "@codewide/sync-client/v2";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { ActivityIndicator, Text } from "react-native";

import { useV2Runtime } from "../../V2Application";
import type { SavedServerId } from "../../domain/ids";
import type { QueryResource } from "../../application/resources/queryResource";
import { WorkspaceView } from "../../ui/layouts/WorkspaceView";

export function V2QueryBoundary({
  children,
  query,
  savedServerId,
  title,
}: {
  children(result: V2QueryResult, refresh: () => Promise<void>): ReactNode;
  query: V2Query;
  savedServerId: SavedServerId;
  title: string;
}): React.JSX.Element {
  const runtime = useV2Runtime();
  const [outer] = useState(() => runtime.query(savedServerId, query));
  const opened = useSyncExternalStore(outer.subscribe, outer.snapshot, outer.snapshot);
  if (opened.value === null) {
    return (
      <WorkspaceView title={title}>
        <ActivityIndicator accessibilityLabel={`Loading ${title}`} />
      </WorkspaceView>
    );
  }
  return (
    <LoadedQuery resource={opened.value} title={title}>
      {children}
    </LoadedQuery>
  );
}

function LoadedQuery({
  children,
  resource,
  title,
}: {
  children(result: V2QueryResult, refresh: () => Promise<void>): ReactNode;
  resource: QueryResource;
  title: string;
}): React.JSX.Element {
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  return (
    <WorkspaceView title={title}>
      {snapshot.value === null ? (
        snapshot.status === "error" ? (
          <Text style={{ color: "#ff8b8b" }}>{snapshot.message}</Text>
        ) : (
          <ActivityIndicator accessibilityLabel={`Reading ${title}`} />
        )
      ) : (
        children(snapshot.value, () => resource.refresh())
      )}
    </WorkspaceView>
  );
}
