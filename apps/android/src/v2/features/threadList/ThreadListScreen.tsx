import { router } from "expo-router";
import { useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { useV2Runtime } from "../../V2Application";
import { threadId, type SavedServerId } from "../../domain/ids";
import { qualifiedThread } from "../../domain/qualifiedThread";
import { WorkspaceView } from "../../ui/layouts/WorkspaceView";
import { ThreadListView } from "../../ui/navigation/ThreadListView";
import type { ProjectionResource } from "../../application/resources/projectionResource";
import { ActionPressable } from "../../ui/actions/ActionPressable";
import {
  accountSettingsDestination,
  newThreadDestination,
  portsDestination,
  serverSettingsDestination,
  threadDestination,
} from "../navigation/routeDestinations";

export function ThreadListScreen({
  savedServerId,
}: {
  savedServerId: SavedServerId;
}): React.JSX.Element {
  const runtime = useV2Runtime();
  const [outer] = useState(() => runtime.projection(savedServerId));
  const opened = useSyncExternalStore(outer.subscribe, outer.snapshot, outer.snapshot);
  if (opened.value === null) {
    return (
      <WorkspaceView title="CodeWide V2">
        <ActivityIndicator accessibilityLabel="Opening V2 saved server" />
      </WorkspaceView>
    );
  }
  return <ProjectedThreadList resource={opened.value} savedServerId={savedServerId} />;
}

function ProjectedThreadList({
  resource,
  savedServerId,
}: {
  resource: ProjectionResource;
  savedServerId: SavedServerId;
}): React.JSX.Element {
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const projection = snapshot.value.projections.live ?? snapshot.value.projections.retained;
  const retained = snapshot.value.projections.live === null;
  return (
    <WorkspaceView
      subtitle={
        <Text style={{ color: snapshot.value.state === "live" ? "#35c778" : "#e9872c" }}>
          {snapshot.value.state}
        </Text>
      }
      title="Threads"
    >
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, padding: 12 }}>
        <ActionPressable
          action={{
            id: "new-thread",
            label: "New thread",
            run: () => router.push(newThreadDestination(savedServerId)),
          }}
        />
        <ActionPressable
          action={{
            id: "ports",
            label: "Ports",
            run: () => router.push(portsDestination(savedServerId)),
          }}
        />
        <ActionPressable
          action={{
            id: "accounts",
            label: "Accounts",
            run: () => router.push(accountSettingsDestination(savedServerId)),
          }}
        />
        <ActionPressable
          action={{
            id: "server-settings",
            label: "Server settings",
            run: () => router.push(serverSettingsDestination(savedServerId)),
          }}
        />
      </View>
      <ThreadListView
        onOpen={(id) => {
          router.push(threadDestination(qualifiedThread(savedServerId, threadId(id))));
        }}
        rows={(projection?.catalog ?? []).map(({ thread }) => ({
          id: thread.id,
          title: thread.title ?? "Untitled thread",
          state: thread.state,
          updatedAt: thread.updatedAt,
          retained,
        }))}
      />
    </WorkspaceView>
  );
}
