import { router } from "expo-router";

import { useV2Runtime } from "../../V2Application";
import { useLiveQuery } from "../../application/react/useLiveQuery";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import { WorkspaceView } from "../../presentation/layouts/WorkspaceView";
import { ResourceStateView } from "../../presentation/feedback/ResourceStateView";
import { useEvent } from "../../../react/useEvent";
import {
  agentDestination,
  portsDestination,
  threadResourceDestination,
} from "../navigation/routeDestinations";
import { AgentsWorkspace } from "./AgentsWorkspace";
import { ConversationScreen } from "../conversation/ConversationScreen";
import { selectedAgentThread } from "./agentSelection";
import { agentWorkspaceRows } from "./agentWorkspaceRows";

interface AgentsScreenProps {
  owner: QualifiedThread;
  selectedAgentThreadId?: string | null;
}

export function AgentsScreen(props: AgentsScreenProps): React.JSX.Element {
  const { owner, selectedAgentThreadId = null } = props;
  const runtime = useV2Runtime();
  const agentsSnapshot = useLiveQuery(runtime, owner.savedServerId, {
    cursor: null,
    kind: "thread.agents",
    limit: 100,
    threadId: owner.threadId,
  });
  const retryOpening = useEvent(async (): Promise<void> => {
    await runtime.sessions.open(owner.savedServerId, owner.threadId);
  });
  const actionable = agentsSnapshot.authority === "live";
  const openAgent = useEvent((id: string) => {
    if (actionable) router.push(agentDestination(owner, id));
  });
  const close = useEvent(() => router.back());
  const backToAgents = useEvent(() => router.back());
  const openPorts = useEvent(() => router.push(portsDestination(owner.savedServerId)));
  const openResource = useEvent(
    (resourceName: "agents" | "attachments" | "changes" | "terminal") => {
      const child = selectedAgentThread(owner, selectedAgentThreadId);
      if (child === null) return;
      router.push(threadResourceDestination(child, resourceName));
    },
  );
  if (agentsSnapshot.value === null) {
    return (
      <WorkspaceView title="Agents">
        <ResourceStateView
          message={agentsSnapshot.status === "error" ? agentsSnapshot.message : "Loading agents…"}
          onRetry={retryOpening}
          status={agentsSnapshot.status === "error" ? "error" : "loading"}
        />
      </WorkspaceView>
    );
  }
  if (agentsSnapshot.value.kind !== "thread.agents") {
    throw new Error("The server returned the wrong agent relation result");
  }
  const rows = agentWorkspaceRows(agentsSnapshot.value.agents);
  const selected = selectedAgentThread(owner, selectedAgentThreadId);
  const detail =
    selected === null ? null : (
      <ConversationScreen
        onBack={backToAgents}
        onOpenPorts={openPorts}
        onOpenResource={openResource}
        owner={selected}
      />
    );
  return (
    <AgentsWorkspace
      actionable={actionable}
      detail={detail}
      onClose={close}
      onSelect={openAgent}
      rows={rows}
      selectedId={selectedAgentThreadId}
      statusMessage={
        actionable
          ? null
          : agentsSnapshot.status === "error"
            ? agentsSnapshot.message
            : "Refreshing agents…"
      }
    />
  );
}
