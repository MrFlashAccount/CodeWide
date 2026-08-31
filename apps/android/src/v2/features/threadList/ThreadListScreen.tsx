import { router } from "expo-router";
import { useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { useV2Runtime } from "../../V2Application";
import { threadId, type SavedServerId } from "../../domain/ids";
import { qualifiedThread } from "../../domain/qualifiedThread";
import { WorkspaceView } from "../../../presentation/layouts/WorkspaceView";
import { ThreadListView } from "../../../presentation/navigation/ThreadListView";
import type { ProjectionResource } from "../../application/resources/projectionResource";
import { ActionPressable } from "../../ui/actions/ActionPressable";
import {
  accountSettingsDestination,
  newThreadDestination,
  portsDestination,
  serverSettingsDestination,
  threadDestination,
} from "../navigation/routeDestinations";
import { useEvent } from "../../../react/useEvent";

interface ThreadListScreenProps {
  savedServerId: SavedServerId;
}

interface ProjectedThreadListProps extends ThreadListScreenProps {
  resource: ProjectionResource;
}

export function ThreadListScreen({ savedServerId }: ThreadListScreenProps): React.JSX.Element {
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
}: ProjectedThreadListProps): React.JSX.Element {
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const projection = snapshot.value.projections.live ?? snapshot.value.projections.retained;
  const retained = snapshot.value.projections.live === null;
  const openThread = useEvent((id: string) => {
    router.push(threadDestination(qualifiedThread(savedServerId, threadId(id))));
  });
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
        onOpen={openThread}
        rows={(projection?.catalog ?? []).map(({ thread }) => ({
          id: thread.id,
          preview: thread.workspace,
          title: thread.title ?? "Untitled thread",
          state: thread.state,
          updatedAt: formatThreadTime(thread.updatedAt),
          retained,
        }))}
      />
    </WorkspaceView>
  );
}

function formatThreadTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
