import { router } from "expo-router";
import { useState, useSyncExternalStore, type PropsWithChildren } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { SavedServerWorkspaceView } from "../../../presentation/layouts/AdaptiveWorkspaceView";
import { ThreadSidebarView } from "../../../presentation/navigation/ThreadSidebarView";
import type { ProjectionResource } from "../../application/resources/projectionResource";
import type { SavedServerId, ThreadId } from "../../domain/ids";
import { threadId } from "../../domain/ids";
import { qualifiedThread } from "../../domain/qualifiedThread";
import { useV2Runtime } from "../../V2Application";
import {
  newThreadDestination,
  serverSettingsDestination,
  threadDestination,
} from "../navigation/routeDestinations";
import { useEvent } from "../../../react/useEvent";

interface SavedServerWorkspaceChromeProps {
  savedServerId: SavedServerId;
  selectedThreadId: ThreadId | null;
}

interface ProjectedSavedServerWorkspaceProps extends SavedServerWorkspaceChromeProps {
  resource: ProjectionResource;
}

export function SavedServerWorkspaceChrome({
  children,
  savedServerId,
  selectedThreadId,
}: PropsWithChildren<SavedServerWorkspaceChromeProps>): React.JSX.Element {
  const runtime = useV2Runtime();
  const [outer] = useState(() => runtime.projection(savedServerId));
  const opened = useSyncExternalStore(outer.subscribe, outer.snapshot, outer.snapshot);
  if (opened.value === null) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator accessibilityLabel="Opening V2 saved server workspace" />
      </View>
    );
  }
  return (
    <ProjectedSavedServerWorkspace
      resource={opened.value}
      savedServerId={savedServerId}
      selectedThreadId={selectedThreadId}
    >
      {children}
    </ProjectedSavedServerWorkspace>
  );
}

function ProjectedSavedServerWorkspace({
  children,
  resource,
  savedServerId,
  selectedThreadId,
}: PropsWithChildren<ProjectedSavedServerWorkspaceProps>): React.JSX.Element {
  const runtime = useV2Runtime();
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const servers = useSyncExternalStore(
    runtime.savedServers.subscribe,
    runtime.savedServers.snapshot,
    runtime.savedServers.snapshot,
  );
  const projection = snapshot.value.projections.live ?? snapshot.value.projections.retained;
  const server = servers.value.find((candidate) => candidate.id === savedServerId);
  const rows = (projection?.catalog ?? []).map(({ thread }) => ({
    id: thread.id,
    preview: thread.workspace,
    retained: snapshot.value.projections.live === null,
    state: thread.state,
    title: thread.title ?? "Untitled thread",
    updatedAt: formatThreadTime(thread.updatedAt),
  }));
  const createThread = useEvent(() => router.push(newThreadDestination(savedServerId)));
  const openThread = useEvent((id: string) => {
    router.push(threadDestination(qualifiedThread(savedServerId, threadId(id))));
  });
  const openSettings = useEvent(() => router.push(serverSettingsDestination(savedServerId)));
  return (
    <SavedServerWorkspaceView
      emptyMain={selectedThreadId === null}
      sidebar={
        <ThreadSidebarView
          connectionState={snapshot.value.state}
          onNewThread={createThread}
          onOpen={openThread}
          onSettings={openSettings}
          rows={rows}
          {...(selectedThreadId === null ? {} : { selectedId: selectedThreadId })}
          title={server?.displayName ?? "Server"}
        />
      }
    >
      {children}
    </SavedServerWorkspaceView>
  );
}

function formatThreadTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const styles = StyleSheet.create({
  loading: { alignItems: "center", flex: 1, justifyContent: "center" },
});
