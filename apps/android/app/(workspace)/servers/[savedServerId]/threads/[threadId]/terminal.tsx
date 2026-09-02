import { Redirect, useLocalSearchParams } from "expo-router";

import { TerminalScreen } from "../../../../../../src/v2/features/terminal/TerminalScreen";
import { qualifiedThreadRouteParams } from "../../../../../../src/v2/features/navigation/routeParams";

export default function ThreadTerminalRoute(): React.JSX.Element {
  const params = useLocalSearchParams<"/servers/[savedServerId]/threads/[threadId]/terminal">();
  const owner = qualifiedThreadRouteParams(params);
  if (owner === null) return <Redirect href="/servers" />;
  return <TerminalScreen owner={owner} />;
}
