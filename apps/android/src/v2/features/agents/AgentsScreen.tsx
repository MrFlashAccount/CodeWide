import { router } from "expo-router";
import { useState, useSyncExternalStore } from "react";
import { ActivityIndicator } from "react-native";

import { useV2Runtime } from "../../V2Application";
import type { ProjectionResource } from "../../application/resources/projectionResource";
import { qualifiedThread, type QualifiedThread } from "../../domain/qualifiedThread";
import { threadId } from "../../domain/ids";
import { WorkspaceView } from "../../presentation/layouts/WorkspaceView";
import { useEvent } from "../../../react/useEvent";
import {
  agentDestination,
  portsDestination,
  threadResourceDestination,
} from "../navigation/routeDestinations";
import { AgentsWorkspace, type AgentWorkspaceRow } from "./AgentsWorkspace";
import { ConversationScreen } from "../conversation/ConversationScreen";

interface AgentsScreenProps {
  owner: QualifiedThread;
  selectedAgentThreadId?: string | null;
}

interface ProjectedAgentsProps extends AgentsScreenProps {
  resource: ProjectionResource;
}

export function AgentsScreen(props: AgentsScreenProps): React.JSX.Element {
  const { owner } = props;
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

function ProjectedAgents(props: ProjectedAgentsProps): React.JSX.Element {
  const { owner, resource, selectedAgentThreadId = null } = props;
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const projection = snapshot.value.projections.live ?? snapshot.value.projections.retained;
  const agents = (projection?.catalog ?? []).filter((value) => {
    const { thread } = value;
    return thread.parentId === owner.threadId;
  });
  const rows = agents.map((value): AgentWorkspaceRow => {
    const { thread } = value;
    return {
      active: thread.state === "running",
      id: thread.id,
      subtitle: `${thread.state} · ${thread.workspace}`,
      time: formatAgentTime(thread.lastActivityAt ?? thread.updatedAt),
      title: thread.title ?? "Agent thread",
    };
  });
  const openAgent = useEvent((id: string) => router.push(agentDestination(owner, id)));
  const close = useEvent(() => router.back());
  const backToAgents = useEvent(() => router.back());
  const openPorts = useEvent(() => router.push(portsDestination(owner.savedServerId)));
  const openResource = useEvent(
    (resourceName: "agents" | "attachments" | "changes" | "terminal") => {
      if (selectedAgentThreadId === null) return;
      const child = qualifiedThread(owner.savedServerId, threadId(selectedAgentThreadId));
      router.push(threadResourceDestination(child, resourceName));
    },
  );
  const detail =
    selectedAgentThreadId === null ? null : (
      <ConversationScreen
        onBack={backToAgents}
        onOpenPorts={openPorts}
        onOpenResource={openResource}
        owner={qualifiedThread(owner.savedServerId, threadId(selectedAgentThreadId))}
      />
    );
  return (
    <AgentsWorkspace
      detail={detail}
      onClose={close}
      onSelect={openAgent}
      rows={rows}
      selectedId={selectedAgentThreadId}
    />
  );
}

function formatAgentTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
