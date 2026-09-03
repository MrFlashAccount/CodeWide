import { router } from "expo-router";
import { useSyncExternalStore, type PropsWithChildren } from "react";

import {
  ServerWorkspaceView,
  WorkspaceSafeAreaView,
} from "../../presentation/layouts/AdaptiveWorkspaceView";
import { ServerRailView } from "../../presentation/navigation/ServerRailView";
import { useV2Runtime } from "../../V2Application";
import { V2PresentationProvider } from "../../platform/rendering/V2PresentationProvider";
import {
  newSavedServerDestination,
  serverDestination,
  settingsDestination,
} from "../navigation/routeDestinations";
import { serverConnectionRows } from "../serverList/serverConnectionPresentation";
import { useEvent } from "../../../react/useEvent";

interface ServerWorkspaceChromeProps {
  activeSavedServerId: string | null;
}

export function ServerWorkspaceChrome(
  props: PropsWithChildren<ServerWorkspaceChromeProps>,
): React.JSX.Element {
  const { activeSavedServerId, children } = props;
  const runtime = useV2Runtime();
  const servers = useSyncExternalStore(
    runtime.savedServers.subscribe,
    runtime.savedServers.snapshot,
    runtime.savedServers.snapshot,
  );
  const connectionStatuses = useSyncExternalStore(
    runtime.connectionStatuses.subscribe,
    runtime.connectionStatuses.snapshot,
    runtime.connectionStatuses.snapshot,
  );
  const rows = serverConnectionRows(servers.value, connectionStatuses.value);
  const addServer = useEvent(() => router.push(newSavedServerDestination()));
  const openServer = useEvent((id: string) => {
    const server = servers.value.find((candidate) => candidate.id === id);
    if (server === undefined || server.id === activeSavedServerId) return;
    router.replace(serverDestination(server.id));
  });
  const openSettings = useEvent(() => router.push(settingsDestination()));
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
