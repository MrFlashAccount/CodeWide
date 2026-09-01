import { router } from "expo-router";
import { useSyncExternalStore, type PropsWithChildren } from "react";

import {
  ServerWorkspaceView,
  WorkspaceSafeAreaView,
} from "../../../presentation/layouts/AdaptiveWorkspaceView";
import { ServerRailView } from "../../../presentation/navigation/ServerRailView";
import { useV2Runtime } from "../../V2Application";
import { V2PresentationProvider } from "../../platform/rendering/V2PresentationProvider";
import { serverDestination } from "../navigation/routeDestinations";
import { useEvent } from "../../../react/useEvent";

interface ServerWorkspaceChromeProps {
  activeSavedServerId: string | null;
}

export function ServerWorkspaceChrome({
  activeSavedServerId,
  children,
}: PropsWithChildren<ServerWorkspaceChromeProps>): React.JSX.Element {
  const runtime = useV2Runtime();
  const servers = useSyncExternalStore(
    runtime.savedServers.subscribe,
    runtime.savedServers.snapshot,
    runtime.savedServers.snapshot,
  );
  const rows = servers.value.map((server) => ({
    detail: server.enabled ? "Enabled" : "Disabled",
    emoji: server.emoji,
    id: server.id,
    label: server.displayName,
  }));
  const addServer = useEvent(() => router.push("/settings/servers/new"));
  const openServer = useEvent((id: string) => {
    const server = servers.value.find((candidate) => candidate.id === id);
    if (server !== undefined) router.push(serverDestination(server.id));
  });
  const openSettings = useEvent(() => router.push("/settings"));
  return (
    <V2PresentationProvider>
      <WorkspaceSafeAreaView>
        <ServerWorkspaceView
          rail={
            <ServerRailView
              {...(activeSavedServerId === null ? {} : { activeId: activeSavedServerId })}
              onAdd={addServer}
              onOpen={openServer}
              onSettings={openSettings}
              rows={rows}
            />
          }
        >
          {children}
        </ServerWorkspaceView>
      </WorkspaceSafeAreaView>
    </V2PresentationProvider>
  );
}
