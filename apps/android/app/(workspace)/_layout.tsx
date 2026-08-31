import { Stack, useGlobalSearchParams } from "expo-router";

import { ServerWorkspaceChrome } from "../../src/v2/features/workspace/ServerWorkspaceChrome";

export const unstable_settings = { initialRouteName: "servers" };

export default function WorkspaceLayout(): React.JSX.Element {
  const savedServerId = useGlobalSearchParams<{ savedServerId?: string | string[] }>()
    .savedServerId;
  return (
    <ServerWorkspaceChrome
      activeSavedServerId={typeof savedServerId === "string" ? savedServerId : null}
    >
      <Stack screenOptions={{ headerShown: false }} />
    </ServerWorkspaceChrome>
  );
}
