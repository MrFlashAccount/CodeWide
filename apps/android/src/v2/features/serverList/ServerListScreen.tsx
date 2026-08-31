import { router } from "expo-router";
import { useSyncExternalStore } from "react";
import { Text } from "react-native";

import { useV2Runtime } from "../../V2Application";
import { serverDestination } from "../navigation/routeDestinations";
import { WorkspaceView } from "../../../presentation/layouts/WorkspaceView";
import { ServerPickerView } from "../../../presentation/navigation/ServerPickerView";
import { useEvent } from "../../../react/useEvent";

export function ServerListScreen(): React.JSX.Element {
  const runtime = useV2Runtime();
  const servers = useSyncExternalStore(
    runtime.savedServers.subscribe,
    runtime.savedServers.snapshot,
    runtime.savedServers.snapshot,
  );
  const addServer = useEvent(() => router.push("/settings/servers/new"));
  const openServer = useEvent((id: string) => {
    const server = servers.value.find((candidate) => candidate.id === id);
    if (server !== undefined) router.push(serverDestination(server.id));
  });
  return (
    <WorkspaceView
      subtitle={<Text style={{ color: "#58c7ff" }}>All saved servers</Text>}
      title="CodeWide V2"
    >
      <ServerPickerView
        onAdd={addServer}
        onOpen={openServer}
        rows={servers.value.map((server) => ({
          id: server.id,
          emoji: server.emoji,
          label: server.displayName,
          detail: server.enabled ? "Enabled" : "Disabled",
        }))}
      />
    </WorkspaceView>
  );
}
