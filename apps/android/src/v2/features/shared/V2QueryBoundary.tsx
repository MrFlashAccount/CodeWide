import type { V2Query, V2QueryResult } from "@codewide/sync-client/v2";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useV2Runtime } from "../../V2Application";
import type { SavedServerId } from "../../domain/ids";
import type { QueryResource } from "../../application/resources/queryResource";
import { WorkspaceView } from "../../presentation/layouts/WorkspaceView";
import { ShimmerText } from "../../presentation/text/ShimmerText";

interface V2QueryBoundaryProps {
  children(result: V2QueryResult, refresh: () => Promise<void>): ReactNode;
  chrome?: "none" | "workspace";
  query: V2Query;
  savedServerId: SavedServerId;
  title: string;
}

interface LoadedQueryProps {
  children(result: V2QueryResult, refresh: () => Promise<void>): ReactNode;
  chrome: "none" | "workspace";
  resource: QueryResource;
  title: string;
}

export function V2QueryBoundary(props: V2QueryBoundaryProps): React.JSX.Element {
  const { children, chrome = "workspace", query, savedServerId, title } = props;
  const runtime = useV2Runtime();
  const [outer] = useState(() => runtime.query(savedServerId, query));
  const opened = useSyncExternalStore(outer.subscribe, outer.snapshot, outer.snapshot);
  if (opened.value === null) {
    const loading = (
      <View style={styles.center}>
        <ShimmerText text={`Loading ${title}…`} />
      </View>
    );
    return chrome === "workspace" ? (
      <WorkspaceView title={title}>{loading}</WorkspaceView>
    ) : (
      loading
    );
  }
  return (
    <LoadedQuery chrome={chrome} resource={opened.value} title={title}>
      {children}
    </LoadedQuery>
  );
}

function LoadedQuery(props: LoadedQueryProps): React.JSX.Element {
  const { children, chrome, resource, title } = props;
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const content =
    snapshot.value === null ? (
      snapshot.status === "error" ? (
        <View style={styles.center}>
          <Text style={styles.error}>{snapshot.message}</Text>
        </View>
      ) : (
        <View style={styles.center}>
          <ShimmerText text={`Reading ${title}…`} />
        </View>
      )
    ) : (
      children(snapshot.value, () => resource.refresh())
    );
  return chrome === "workspace" ? (
    <WorkspaceView title={title}>{content}</WorkspaceView>
  ) : (
    <View style={styles.content}>{content}</View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", flex: 1, justifyContent: "center" },
  content: { flex: 1, minHeight: 0 },
  error: { color: "#ff8b8b" },
});
