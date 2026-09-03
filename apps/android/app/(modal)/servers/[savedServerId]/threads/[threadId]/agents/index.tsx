import { Redirect, useLocalSearchParams } from "expo-router";

import { AgentsScreen } from "@/v2/features/agents/AgentsScreen";
import { qualifiedThreadRouteParams } from "@/v2/features/navigation/routeParams";

export default function AgentsRoute(): React.JSX.Element {
  const params = useLocalSearchParams<"/servers/[savedServerId]/threads/[threadId]/agents">();
  const owner = qualifiedThreadRouteParams(params);
  if (owner === null) return <Redirect href="/servers" />;
  return <AgentsScreen owner={owner} />;
}
