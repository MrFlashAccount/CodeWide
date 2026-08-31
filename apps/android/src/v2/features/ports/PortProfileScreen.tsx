import type { V2TunnelCreateResponse } from "@codewide/sync-client/v2";
import { useState, useSyncExternalStore } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useV2Runtime } from "../../V2Application";
import type { SavedServerId } from "../../domain/ids";
import { ActionPressable } from "../../ui/actions/ActionPressable";
import { WorkspaceView } from "../../../presentation/layouts/WorkspaceView";

interface PortProfileScreenProps {
  profileId: string;
  savedServerId: SavedServerId;
}

export function PortProfileScreen({
  profileId,
  savedServerId,
}: PortProfileScreenProps): React.JSX.Element {
  const runtime = useV2Runtime();
  const [resource] = useState(() => runtime.ports(savedServerId));
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const [tunnel, setTunnel] = useState<V2TunnelCreateResponse | null>(null);
  const port = snapshot.value.ports.find((candidate) => candidate.forwardingKey === profileId);
  return (
    <WorkspaceView
      title={port?.name === undefined || port.name === "" ? "Port profile" : port.name}
    >
      {port === undefined ? (
        <Text style={styles.muted}>
          {snapshot.status === "loading" ? "Scanning port…" : "This port is no longer available."}
        </Text>
      ) : (
        <View style={styles.content}>
          <Text style={styles.value}>localhost:{port.port}</Text>
          <Text style={styles.muted}>{port.details}</Text>
          {port.process === null ? null : (
            <Text style={styles.muted}>
              {port.process}
              {port.pid === null ? "" : ` · PID ${port.pid}`}
            </Text>
          )}
          {tunnel === null ? (
            <ActionPressable
              action={{
                id: `create-tunnel-${port.port}`,
                label: "Create secure tunnel",
                run: async () => setTunnel(await resource.createTunnel(port.port)),
              }}
            />
          ) : (
            <>
              <Text selectable style={styles.value}>
                {tunnel.basePath}
              </Text>
              <Text style={styles.muted}>
                Expires {new Date(tunnel.expiresAt).toLocaleString()}
              </Text>
              <ActionPressable
                action={{
                  id: `close-tunnel-${tunnel.id}`,
                  label: "Close tunnel",
                  run: async () => {
                    await resource.deleteTunnel(tunnel.id);
                    setTunnel(null);
                  },
                }}
              />
            </>
          )}
        </View>
      )}
    </WorkspaceView>
  );
}

const styles = StyleSheet.create({
  content: { gap: 10, padding: 16 },
  muted: { color: "#a8a8ad", padding: 16 },
  value: { color: "#fafafa", fontSize: 16 },
});
