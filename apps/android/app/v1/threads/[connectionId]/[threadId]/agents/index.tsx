import { useTransition } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";

import { SubagentListProjection } from "../../../../../../src/data/subagent-projection";
import { useThreadSummaryView } from "../../../../../../src/data/use-thread-summary-view";
import { RouteUnavailable } from "../../../../../../src/components/navigation/RouteUnavailable";
import { recoverUnavailableRoute } from "../../../../../../src/components/navigation/routeRecovery";
import { RouteSubagentWorkspace } from "../../../../../../src/features/agents/RouteSubagentWorkspace";
import type { SubagentRouteSelection } from "../../../../../../src/features/agents/subagentRouteSelection";
import { SUBAGENT_LIST_LIMIT } from "../../../../../../src/features/agents/agentSelection";
import { SubagentConversation } from "../../../../../../src/features/conversation/SubagentConversation";
import { useTurnChangesLoader } from "../../../../../../src/features/changes/turnChanges";
import { useConstant } from "../../../../../../src/react/useConstant";
import { workspaceFeatures as features } from "../../../../../../src/features/workspace/createWorkspaceFeatures";
import {
  threadIdParam,
  v1ThreadRouteParams,
  v1ThreadDestination,
  type V1ThreadRouteParams,
} from "../../../../../../src/services/threads/threadRouteParams";
import { useWorkspaceRouteResources } from "../../../../../../src/services/workspace/workspaceRouteResources";

const MASTER_SUBAGENT_SELECTION = { status: "master" } as const;
const loadTurnItems = features.conversation.loadTurnItems.bind(features.conversation);

interface V1AgentsRouteContentProps {
  readonly selection: SubagentRouteSelection;
}

interface ValidAgentsRouteProps {
  readonly params: V1ThreadRouteParams;
  readonly parentAgentThreadId: string | null;
  readonly selection: SubagentRouteSelection;
}

/** Presents the Router-owned subagent master route for one qualified thread. */
export default function V1AgentsRoute(): React.JSX.Element {
  return <V1AgentsRouteContent selection={MASTER_SUBAGENT_SELECTION} />;
}

export function V1AgentsRouteContent(props: V1AgentsRouteContentProps): React.JSX.Element {
  const { selection } = props;
  const router = useRouter();
  const raw = useLocalSearchParams<{
    connectionId?: string | string[];
    parentAgentThreadId?: string | string[];
    threadId?: string | string[];
  }>();
  const params = v1ThreadRouteParams(raw);
  const parentAgent =
    raw.parentAgentThreadId === undefined ? null : threadIdParam(raw.parentAgentThreadId);
  if (params.status === "invalid" || parentAgent?.status === "invalid") {
    return (
      <RouteUnavailable
        message="This thread link is invalid."
        onBack={() => {
          router.dismissTo("/v1");
        }}
        title="Subagents unavailable"
      />
    );
  }
  return (
    <ValidAgentsRoute
      params={params.value}
      parentAgentThreadId={parentAgent?.value.value ?? null}
      selection={selection}
    />
  );
}

function ValidAgentsRoute(props: ValidAgentsRouteProps): React.JSX.Element {
  const { params, parentAgentThreadId, selection } = props;
  const router = useRouter();
  const resources = useWorkspaceRouteResources();
  const { loadTurnChanges } = useTurnChangesLoader(loadTurnItems);
  const projection = useConstant(() => new SubagentListProjection());
  const [, startSubagentTransition] = useTransition();
  const connectionId = params.connectionId.value;
  const threadId = params.threadId.value;
  const parentThreadId = parentAgentThreadId ?? threadId;
  const view = useThreadSummaryView(resources.runtime.threadSummaries, {
    archivedLimit: 0,
    connectionId: null,
    recentLimit: 0,
    selectedConnectionId: null,
    selectedThreadId: null,
    subagentConnectionId: connectionId,
    subagentLimit: SUBAGENT_LIST_LIMIT,
    viewId: `subagents:${connectionId}:${parentThreadId}`,
  });
  const summaries = projection.project(view?.subagents ?? []);
  const threadDetails = resources.runtime.threadDetails;
  const back = (): void => {
    recoverUnavailableRoute(router, v1ThreadDestination(params));
  };
  if (threadDetails === null) {
    return (
      <RouteUnavailable
        message="Thread details are not ready."
        onBack={back}
        title="Subagents unavailable"
      />
    );
  }
  const select = (agentThreadId: string): void => {
    startSubagentTransition(() => {
      router.push({
        params: {
          agentThreadId,
          connectionId,
          ...(parentAgentThreadId === null ? {} : { parentAgentThreadId }),
          threadId,
        },
        pathname: "/v1/threads/[connectionId]/[threadId]/agents/[agentThreadId]",
      });
    });
  };
  return (
    <RouteSubagentWorkspace
      connectionId={connectionId}
      onBack={back}
      onClose={back}
      onSelect={select}
      parentThread={threadDetails.getThread(connectionId, parentThreadId)}
      parentThreadId={parentThreadId}
      renderThread={(viewProps) => (
        <SubagentConversation
          details={resources.runtime.threadDetails}
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
          view={viewProps}
        />
      )}
      selection={selection}
      summaries={summaries}
      threadDetails={threadDetails}
    />
  );
}
