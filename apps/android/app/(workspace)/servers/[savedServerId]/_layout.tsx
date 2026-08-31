import { Stack, useGlobalSearchParams, useLocalSearchParams } from "expo-router";

import {
  requireSavedServerRouteParam,
  requireThreadRouteParam,
} from "../../../../src/v2/features/navigation/routeParams";
import { SavedServerWorkspaceChrome } from "../../../../src/v2/features/workspace/SavedServerWorkspaceChrome";

export const unstable_settings = { initialRouteName: "index" };

export default function SavedServerLayout(): React.JSX.Element {
  const savedServerId = requireSavedServerRouteParam(useLocalSearchParams().savedServerId);
  const rawThreadId = useGlobalSearchParams<{ threadId?: string | string[] }>().threadId;
  const selectedThreadId = rawThreadId === undefined ? null : requireThreadRouteParam(rawThreadId);
  return (
    <SavedServerWorkspaceChrome savedServerId={savedServerId} selectedThreadId={selectedThreadId}>
      <Stack screenOptions={{ headerShown: false }} />
    </SavedServerWorkspaceChrome>
  );
}
