import { router } from "expo-router";
import { useState, useSyncExternalStore } from "react";
import { Text } from "react-native";

import { useV2Runtime } from "../../V2Application";
import type { SavedServerId } from "../../domain/ids";
import { ActionPressable } from "../../ui/actions/ActionPressable";
import { WorkspaceView } from "../../ui/layouts/WorkspaceView";
import { ResourceListView } from "../../ui/resources/ResourceListView";
import { portDestination } from "../navigation/routeDestinations";

export function PortsScreen({
  savedServerId,
}: {
  savedServerId: SavedServerId;
}): React.JSX.Element {
  const runtime = useV2Runtime();
  const [resource] = useState(() => runtime.ports(savedServerId));
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  return (
    <WorkspaceView
      subtitle={<Text style={{ color: "#a8a8ad" }}>{snapshot.status}</Text>}
      title="Ports"
    >
      <ActionPressable
        action={{ id: "refresh-ports", label: "Scan ports", run: () => resource.refresh() }}
      />
      <ResourceListView
        empty={snapshot.status === "loading" ? "Scanning ports…" : "No discoverable ports"}
        rows={snapshot.value.ports.map((port) => ({
          detail: `${port.group} · ${port.details}`,
          id: port.forwardingKey,
          label: `${port.name === "" ? "Port" : port.name} · ${port.port}`,
          onPress: () => router.push(portDestination(savedServerId, port.forwardingKey)),
        }))}
      />
    </WorkspaceView>
  );
}
