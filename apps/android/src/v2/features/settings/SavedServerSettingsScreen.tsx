import { useState, useSyncExternalStore } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { useV2Runtime } from "../../V2Application";
import type { SavedServerId } from "../../domain/ids";
import { ActionPressable } from "../../ui/actions/ActionPressable";
import { WorkspaceView } from "../../ui/layouts/WorkspaceView";

export function SavedServerSettingsScreen({
  onDeleted,
  savedServerId,
}: {
  onDeleted(): void | Promise<void>;
  savedServerId: SavedServerId;
}): React.JSX.Element {
  const runtime = useV2Runtime();
  const [resource] = useState(() => runtime.savedServerConnection(savedServerId));
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const connection = snapshot.value;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  return (
    <WorkspaceView title="Server settings">
      {connection === null ? (
        <ActivityIndicator accessibilityLabel="Loading server settings" />
      ) : (
        <View style={styles.content}>
          <Text style={styles.label}>Saved server</Text>
          <Text selectable style={styles.value}>
            {connection.id}
          </Text>
          <Text style={styles.label}>Endpoint</Text>
          <Text selectable style={styles.value}>
            {connection.endpoint}
          </Text>
          <Text style={styles.label}>Connection</Text>
          <Text style={styles.value}>{connection.enabled ? "Enabled" : "Disabled"}</Text>
          <ActionPressable
            action={{
              id: "toggle-saved-server",
              label: connection.enabled ? "Disable server" : "Enable server",
              run: async () => {
                await runtime.setSavedServerEnabled(savedServerId, !connection.enabled);
                await resource.refresh();
              },
            }}
          />
          <ActionPressable
            action={{
              disabled: !connection.enabled,
              id: "reconnect-saved-server",
              label: "Reconnect server",
              run: () => runtime.reconnect(savedServerId),
            }}
          />
          {confirmingDelete ? (
            <View style={styles.dangerZone}>
              <Text accessibilityLiveRegion="polite" style={styles.warning}>
                Delete this saved server? Its local V2 data, credentials, live sessions, and native
                capabilities will be removed from this device.
              </Text>
              {deleteError === null ? null : (
                <Text accessibilityLiveRegion="polite" style={styles.error}>
                  {deleteError}
                </Text>
              )}
              <ActionPressable
                action={{
                  id: "confirm-delete-saved-server",
                  label: "Confirm delete server",
                  run: async () => {
                    setDeleteError(null);
                    try {
                      await runtime.deleteSavedServer(savedServerId);
                      await onDeleted();
                    } catch {
                      setDeleteError("Could not delete this saved server. Try again.");
                    }
                  },
                }}
              />
              <ActionPressable
                action={{
                  id: "cancel-delete-saved-server",
                  label: "Keep server",
                  run: () => {
                    setDeleteError(null);
                    setConfirmingDelete(false);
                  },
                }}
              />
            </View>
          ) : (
            <ActionPressable
              action={{
                id: "delete-saved-server",
                label: "Delete saved server",
                run: () => setConfirmingDelete(true),
              }}
            />
          )}
        </View>
      )}
    </WorkspaceView>
  );
}

const styles = StyleSheet.create({
  content: { gap: 10, padding: 16 },
  dangerZone: { borderColor: "#9f1239", borderRadius: 10, borderWidth: 1, gap: 10, padding: 12 },
  error: { color: "#ff8b8b" },
  label: { color: "#a8a8ad", fontSize: 13 },
  value: { color: "#fafafa", fontSize: 15 },
  warning: { color: "#fecaca", lineHeight: 20 },
});
