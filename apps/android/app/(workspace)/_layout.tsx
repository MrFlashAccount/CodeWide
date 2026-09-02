import { Stack, useGlobalSearchParams } from "expo-router";

import { ServerWorkspaceChrome } from "../../src/v2/features/workspace/ServerWorkspaceChrome";

export const unstable_settings = { initialRouteName: "servers" };
const SCREEN_OPTIONS = { animation: "none", headerShown: false } as const;

export default function WorkspaceLayout(): React.JSX.Element {
  const savedServerId = useGlobalSearchParams<{ savedServerId?: string | string[] }>()
    .savedServerId;
  return (
    <ServerWorkspaceChrome
      activeSavedServerId={typeof savedServerId === "string" ? savedServerId : null}
    >
      <Stack screenOptions={SCREEN_OPTIONS} />
    </ServerWorkspaceChrome>
  );
}
