import { useLocalSearchParams, useRouter } from "expo-router";

import { RouteUnavailable } from "../../../../../../src/components/navigation/RouteUnavailable";
import { recoverUnavailableRoute } from "../../../../../../src/components/navigation/routeRecovery";
import { SubagentSheet } from "../../../../../../src/features/agents/SubagentSheet";
import { ConversationRouteFullscreenOverlay } from "../../../../../../src/features/conversation/ConversationRouteFullscreenOverlay";
import { SubagentConversation } from "../../../../../../src/features/conversation/SubagentConversation";
import { useTurnChangesLoader } from "../../../../../../src/features/changes/turnChanges";
import { workspaceFeatures as features } from "../../../../../../src/features/workspace/createWorkspaceFeatures";
import { agentRouteSessions } from "../../../../../../src/services/agents/agentRouteSession";
import {
  routeSessionIdParam,
  threadRouteSessionOwner,
  v1ThreadDestination,
  v1ThreadRouteParams,
  type V1ThreadRouteParams,
} from "../../../../../../src/services/threads/threadRouteParams";
import { useRouteSessionLifetime } from "../../../../../../src/services/useRouteSessionLifetime";
import { useWorkspaceRouteResources } from "../../../../../../src/services/workspace/workspaceRouteResources";

const loadTurnItems = features.conversation.loadTurnItems.bind(features.conversation);

interface V1AgentsRouteContentProps {
  readonly initialThreadId?: string | null;
}

interface ValidAgentsRouteProps {
  readonly initialThreadId: string | null;
  readonly params: V1ThreadRouteParams;
  readonly sessionId: string;
}

/** Presents the route-owned fullscreen entry for the original V1 subagent workspace. */
export default function V1AgentsRoute(): React.JSX.Element {
  return <V1AgentsRouteContent />;
}

export function V1AgentsRouteContent({
  initialThreadId = null,
}: V1AgentsRouteContentProps): React.JSX.Element {
  const router = useRouter();
  const raw = useLocalSearchParams<{
    connectionId?: string | string[];
    sessionId?: string | string[];
    threadId?: string | string[];
  }>();
  const params = v1ThreadRouteParams(raw);
  const sessionId = routeSessionIdParam(raw.sessionId);
  if (params.status === "invalid" || sessionId.status === "invalid") {
    const back = (): void => {
      if (params.status === "valid") {
        recoverUnavailableRoute(router, v1ThreadDestination(params.value));
        return;
      }
      router.dismissTo("/v1");
    };
    return (
      <RouteUnavailable
        message="This subagent workspace link is invalid or has expired."
        onBack={back}
        title="Subagents unavailable"
      />
    );
  }
  return (
    <ValidAgentsRoute
      initialThreadId={initialThreadId}
      params={params.value}
      sessionId={sessionId.value.value}
    />
  );
}

function ValidAgentsRoute({
  initialThreadId,
  params,
  sessionId,
}: ValidAgentsRouteProps): React.JSX.Element {
  const router = useRouter();
  const resources = useWorkspaceRouteResources();
  const { loadTurnChanges } = useTurnChangesLoader(loadTurnItems);
  const owner = threadRouteSessionOwner(params);
  const session = agentRouteSessions.get(sessionId, owner);
  useRouteSessionLifetime(
    session?.id ?? null,
    (id) => {
      agentRouteSessions.close(id);
    },
    (id) => agentRouteSessions.retain(id, owner),
  );
  const back = (): void => {
    recoverUnavailableRoute(router, v1ThreadDestination(params));
  };
  if (session === null) {
    return (
      <RouteUnavailable
        message="Open subagents again from the conversation."
        onBack={back}
        title="Subagents unavailable"
      />
    );
  }
  const threadDetails = resources.runtime.threadDetails;
  if (threadDetails === null) {
    return (
      <RouteUnavailable
        message="Thread details are not ready."
        onBack={back}
        title="Subagents unavailable"
      />
    );
  }
  const connectionId = params.connectionId.value;
  const request = session.request;
  return (
    <ConversationRouteFullscreenOverlay
      onDismiss={back}
      render={(closeOverlay) => (
        <SubagentSheet
          connectionId={connectionId}
          initialThreadId={initialThreadId ?? request.initialThreadId}
          onClose={closeOverlay}
          parentThread={request.parentThread}
          parentThreadId={request.parentThreadId}
          renderThread={(view) => (
            <SubagentConversation
              details={threadDetails}
              fixUnsupportedBlock={resources.recovery.createUnsupportedFixThread}
              getTransferAccess={async (forceRefresh) =>
                features.attachments.transferAccess(connectionId, forceRefresh)
              }
              loadTurnChanges={loadTurnChanges}
              refresh={async (rootThreadId) =>
                features.agents.refreshSubagents(connectionId, rootThreadId)
              }
              server={resources.list.servers.find((server) => server.id === connectionId)}
              summaries={resources.runtime.threadSummaries}
              view={view}
            />
          )}
          summaries={request.summaries}
          threadDetails={threadDetails}
        />
      )}
      scope={`agents:${session.id}`}
    />
  );
}
