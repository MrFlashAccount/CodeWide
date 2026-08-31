import { router } from "expo-router";
import { useSyncExternalStore } from "react";
import { Text } from "react-native";

import { useV2Runtime } from "../../V2Application";
import { serverDestination } from "../navigation/routeDestinations";
import { WorkspaceView } from "../../ui/layouts/WorkspaceView";
import { ServerRailView } from "../../ui/navigation/ServerRailView";
import { ActionPressable } from "../../ui/actions/ActionPressable";

export function ServerListScreen(): React.JSX.Element {
  const runtime = useV2Runtime();
  const servers = useSyncExternalStore(
    runtime.savedServers.subscribe,
    runtime.savedServers.snapshot,
    runtime.savedServers.snapshot,
  );
  return (
    <WorkspaceView
      subtitle={<Text style={{ color: "#58c7ff" }}>All saved servers</Text>}
      title="CodeWide V2"
    >
      <ActionPressable
        action={{
          id: "add-server",
          label: "Add server",
          run: () => router.push("/settings/servers/new"),
        }}
      />
      <ServerRailView
        onOpen={(id) => {
          router.push(serverDestination(id as (typeof servers.value)[number]["id"]));
        }}
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
