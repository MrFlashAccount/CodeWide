import type { V2Query } from "@codewide/sync-client/v2";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { useV2Runtime } from "../../V2Application";
import type { SavedServerId } from "../../domain/ids";
import type {
  QueryResource,
  QueryResourceFailure,
} from "../../application/resources/queryResource";
import {
  QueryProtocolError,
  type QueryResultFor,
} from "../../application/resources/queryCorrelation";
import { ResourceStateView } from "../../presentation/feedback/ResourceStateView";
import { WorkspaceView } from "../../presentation/layouts/WorkspaceView";
import { useEvent } from "../../../react/useEvent";
import { ProductText } from "../../presentation/text/ProductText";
import { colors, spacing, typeScale } from "../../theme";

export interface V2QueryAvailability {
  actionable: boolean;
  failure: QueryResourceFailure | null;
  refreshing: boolean;
}

interface V2QueryBoundaryProps<Q extends V2Query> {
  children(
    result: QueryResultFor<Q>,
    refresh: () => Promise<void>,
    availability: V2QueryAvailability,
  ): ReactNode;
  chrome?: "none" | "workspace";
  query: Q;
  savedServerId: SavedServerId;
  title: string;
}

interface LoadedQueryProps<Q extends V2Query> {
  children(
    result: QueryResultFor<Q>,
    refresh: () => Promise<void>,
    availability: V2QueryAvailability,
  ): ReactNode;
  chrome: "none" | "workspace";
  query: Q;
  resource: QueryResource<Q>;
  title: string;
}

export function V2QueryBoundary<Q extends V2Query>(
  props: V2QueryBoundaryProps<Q>,
): React.JSX.Element {
  const { children, chrome = "workspace", query, savedServerId, title } = props;
  const runtime = useV2Runtime();
  const [outer] = useState(() => runtime.query(savedServerId, query));
  const opened = useSyncExternalStore(outer.subscribe, outer.snapshot, outer.snapshot);
  const retryOpening = useEvent((): Promise<void> => outer.refresh());
  if (opened.value === null) {
    const state = (
      <ResourceStateView
        message={opened.status === "error" ? opened.message : `Loading ${title}…`}
        onRetry={retryOpening}
        status={opened.status === "error" ? "error" : "loading"}
      />
    );
    return chrome === "workspace" ? <WorkspaceView title={title}>{state}</WorkspaceView> : state;
  }
  return (
    <LoadedQuery chrome={chrome} query={query} resource={opened.value} title={title}>
      {children}
    </LoadedQuery>
  );
}

function LoadedQuery<Q extends V2Query>(props: LoadedQueryProps<Q>): React.JSX.Element {
  const { children, chrome, query, resource, title } = props;
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const retry = useEvent((): Promise<void> => resource.refresh());
  const mismatchedResult =
    snapshot.value !== null && snapshot.value.kind !== query.kind
      ? new QueryProtocolError(query.kind, snapshot.value.kind)
      : null;
  const content =
    snapshot.value === null ? (
      <ResourceStateView
        message={snapshot.status === "error" ? snapshot.message : `Reading ${title}…`}
        onRetry={retry}
        status={snapshot.status === "error" ? "error" : "loading"}
      />
    ) : mismatchedResult !== null ? (
      <ResourceStateView message={mismatchedResult.message} onRetry={retry} status="error" />
    ) : (
      <View style={styles.loaded}>
        {snapshot.authority === "live" ? null : (
          <ProductText
            accessibilityLiveRegion="polite"
            style={styles.retained}
            tone={snapshot.status === "error" ? "danger" : "muted"}
          >
            {snapshot.status === "error" ? snapshot.message : `Refreshing ${title}…`}
          </ProductText>
        )}
        <View style={styles.content}>
          {children(snapshot.value, () => resource.refresh(), {
            actionable: snapshot.authority === "live",
            failure: snapshot.status === "error" ? snapshot.failure : null,
            refreshing: snapshot.status === "loading",
          })}
        </View>
      </View>
    );
  return chrome === "workspace" ? (
    <WorkspaceView title={title}>{content}</WorkspaceView>
  ) : (
    <View style={styles.content}>{content}</View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, minHeight: 0 },
  loaded: { flex: 1, minHeight: 0 },
  retained: {
    backgroundColor: colors.surfaceContainer,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    ...typeScale.caption,
  },
});
