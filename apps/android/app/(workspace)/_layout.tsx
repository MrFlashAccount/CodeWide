import { Redirect, Stack, useLocalSearchParams, usePathname } from "expo-router";

import { useUiGenerationSnapshot } from "../../src/boot/useUiGenerationSnapshot";
import { ServerWorkspaceChrome } from "../../src/v2/features/workspace/ServerWorkspaceChrome";
import { RecoverableRenderBoundary } from "../../src/v2/ui/RecoverableRenderBoundary";

export const unstable_settings = { initialRouteName: "servers" };
const SCREEN_OPTIONS = { animation: "none", headerShown: false } as const;

export default function WorkspaceLayout(): React.JSX.Element {
  const generation = useUiGenerationSnapshot();
  const pathname = usePathname();
  // Local params remain pinned while a transparent modal owns the foreground URL.
  const savedServerId = useLocalSearchParams<{ savedServerId?: string | string[] }>().savedServerId;
  if (generation.status !== "ready") return <Redirect href="/" />;
  if (generation.generation === "legacy") return <Redirect href="/legacy" />;
  return (
    <ServerWorkspaceChrome
      activeSavedServerId={typeof savedServerId === "string" ? savedServerId : null}
    >
      <RecoverableRenderBoundary
        context={`Route: ${pathname}`}
        label="Workspace route"
        resetKey={pathname}
        scope="surface"
      >
        <Stack screenOptions={SCREEN_OPTIONS} />
      </RecoverableRenderBoundary>
    </ServerWorkspaceChrome>
  );
}
