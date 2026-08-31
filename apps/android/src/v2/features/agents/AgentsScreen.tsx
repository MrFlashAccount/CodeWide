import { router } from "expo-router";
import { useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Text } from "react-native";

import { useV2Runtime } from "../../V2Application";
import type { ProjectionResource } from "../../application/resources/projectionResource";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import { WorkspaceView } from "../../../presentation/layouts/WorkspaceView";
import { ResourceListView } from "../../../presentation/resources/ResourceListView";
import { agentDestination } from "../navigation/routeDestinations";

interface AgentsScreenProps {
  owner: QualifiedThread;
}

interface ProjectedAgentsProps extends AgentsScreenProps {
  resource: ProjectionResource;
}

export function AgentsScreen({ owner }: AgentsScreenProps): React.JSX.Element {
  const runtime = useV2Runtime();
  const [outer] = useState(() => runtime.projection(owner.savedServerId));
  const opened = useSyncExternalStore(outer.subscribe, outer.snapshot, outer.snapshot);
  if (opened.value === null) {
    return (
      <WorkspaceView title="Agents">
        <ActivityIndicator accessibilityLabel="Loading agents" />
      </WorkspaceView>
    );
  }
  return <ProjectedAgents owner={owner} resource={opened.value} />;
}

function ProjectedAgents({ owner, resource }: ProjectedAgentsProps): React.JSX.Element {
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const projection = snapshot.value.projections.live ?? snapshot.value.projections.retained;
  const agents = (projection?.catalog ?? []).filter(
    ({ thread }) => thread.parentId === owner.threadId,
  );
  return (
    <WorkspaceView
      subtitle={<Text style={{ color: "#a8a8ad" }}>{snapshot.value.state}</Text>}
      title="Agents"
    >
      <ResourceListView
        empty="No agent threads"
        rows={agents.map(({ thread }) => ({
          detail: `${thread.state} · ${thread.workspace}`,
          id: thread.id,
          label: thread.title ?? "Agent thread",
          onPress: () => router.push(agentDestination(owner, thread.id)),
        }))}
      />
    </WorkspaceView>
  );
}
