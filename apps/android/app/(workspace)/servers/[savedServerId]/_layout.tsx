import { Redirect, Stack, useLocalSearchParams, usePathname } from "expo-router";

import {
  savedServerRouteParam,
  threadRouteParam,
} from "../../../../src/v2/features/navigation/routeParams";
import { SavedServerWorkspaceChrome } from "../../../../src/v2/features/workspace/SavedServerWorkspaceChrome";
import { RecoverableRenderBoundary } from "../../../../src/v2/ui/RecoverableRenderBoundary";

export const unstable_settings = { anchor: "index", initialRouteName: "index" };
const SCREEN_OPTIONS = { animation: "none", headerShown: false } as const;

export default function SavedServerLayout(): React.JSX.Element {
  const pathname = usePathname();
  const params = useLocalSearchParams<"/servers/[savedServerId]">();
  const savedServerId = savedServerRouteParam(params.savedServerId);
  // Local params remain pinned while a transparent modal owns the foreground URL.
  const rawThreadId = useLocalSearchParams<{ threadId?: string | string[] }>().threadId;
  const selectedThreadId = threadRouteParam(rawThreadId);
  if (savedServerId === null) return <Redirect href="/servers" />;
  return (
    <SavedServerWorkspaceChrome savedServerId={savedServerId} selectedThreadId={selectedThreadId}>
      <RecoverableRenderBoundary
        context={`Server: ${savedServerId}\nRoute: ${pathname}`}
        label="Saved server route"
        resetKey={pathname}
        scope="surface"
      >
        <Stack screenOptions={SCREEN_OPTIONS} />
      </RecoverableRenderBoundary>
    </SavedServerWorkspaceChrome>
  );
}
