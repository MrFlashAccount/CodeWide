import { useLocalSearchParams } from "expo-router";

import type { SubagentRouteSelection } from "../../../../../../src/features/agents/subagentRouteSelection";
import { threadIdParam } from "../../../../../../src/services/threads/threadRouteParams";
import { V1AgentsRouteContent } from "./index";

function routeSelection(parsed: ReturnType<typeof threadIdParam>): SubagentRouteSelection {
  return parsed.status === "valid"
    ? { status: "selected", threadId: parsed.value.value }
    : { status: "invalid" };
}

/** Presents one Router-selected subagent while the responsive master pane stays available. */
export default function V1AgentThreadRoute(): React.JSX.Element {
  const { agentThreadId } = useLocalSearchParams<{
    agentThreadId?: string | string[];
  }>();
  const parsed = threadIdParam(agentThreadId);
  return <V1AgentsRouteContent selection={routeSelection(parsed)} />;
}
