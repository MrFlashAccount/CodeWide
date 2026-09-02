import { Redirect, useLocalSearchParams } from "expo-router";
import { AgentThreadScreen } from "../../../../../../../src/v2/features/agents/AgentThreadScreen";
import {
  qualifiedThreadRouteParams,
  threadRouteParam,
} from "../../../../../../../src/v2/features/navigation/routeParams";

export default function AgentThreadRoute(): React.JSX.Element {
  const params =
    useLocalSearchParams<"/servers/[savedServerId]/threads/[threadId]/agents/[agentThreadId]">();
  const owner = qualifiedThreadRouteParams(params);
  const selectedAgentThreadId = threadRouteParam(params.agentThreadId);
  if (owner === null || selectedAgentThreadId === null) return <Redirect href="/servers" />;
  return <AgentThreadScreen owner={owner} selectedAgentThreadId={selectedAgentThreadId} />;
}
