import { Redirect, useLocalSearchParams } from "expo-router";

import { useUiGenerationSnapshot } from "../src/boot/useUiGenerationSnapshot";
import {
  serversDestination,
  threadDestination,
} from "../src/v2/features/navigation/routeDestinations";
import { qualifiedThreadDeepLinkRouteParams } from "../src/v2/features/navigation/routeParams";

/** Routes notification and external thread URLs into the selected UI generation. */
export default function ThreadRoute(): React.JSX.Element | null {
  const params = useLocalSearchParams<"/thread">();
  const generation = useUiGenerationSnapshot();
  if (generation.status === "loading") return null;
  if (generation.status === "error") return <Redirect href="/" />;
  if (generation.generation === "legacy") return <Redirect href="/legacy" />;
  const owner = qualifiedThreadDeepLinkRouteParams({
    connectionId: params.connectionId,
    savedServerId: params.savedServerId,
    threadId: params.threadId,
  });
  return <Redirect href={owner === null ? serversDestination() : threadDestination(owner)} />;
}
