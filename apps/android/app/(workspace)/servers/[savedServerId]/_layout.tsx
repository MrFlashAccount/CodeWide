import { Redirect, Stack, useGlobalSearchParams, useLocalSearchParams } from "expo-router";

import {
  savedServerRouteParam,
  threadRouteParam,
} from "../../../../src/v2/features/navigation/routeParams";
import { SavedServerWorkspaceChrome } from "../../../../src/v2/features/workspace/SavedServerWorkspaceChrome";

export const unstable_settings = { initialRouteName: "index" };
const SCREEN_OPTIONS = { animation: "none", headerShown: false } as const;

export default function SavedServerLayout(): React.JSX.Element {
  const params = useLocalSearchParams<"/servers/[savedServerId]">();
  const savedServerId = savedServerRouteParam(params.savedServerId);
  const rawThreadId = useGlobalSearchParams<{ threadId?: string | string[] }>().threadId;
  const selectedThreadId = threadRouteParam(rawThreadId);
  if (savedServerId === null) return <Redirect href="/servers" />;
  return (
    <SavedServerWorkspaceChrome savedServerId={savedServerId} selectedThreadId={selectedThreadId}>
      <Stack screenOptions={SCREEN_OPTIONS} />
    </SavedServerWorkspaceChrome>
  );
}
