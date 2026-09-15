import { useState } from "react";
import { View } from "react-native";
import { listRowPosition } from "../../ui/AppListRow.types";
import { AppSheet, AppSheetScrollView } from "../../ui/AppSheet";
import { ControlOption } from "../../ui/ControlOption";
import { AppText as Text } from "../../ui/Typography";
import { connectionStateLabel, type ThreadListServer } from "../connections/connectionPresentation";
import { styles } from "./NewThreadServerSheet.styles";

export function NewThreadServerSheet({
  visible,
  servers,
  onClose,
  onSelect,
}: {
  visible: boolean;
  servers: ThreadListServer[];
  onClose(): void;
  onSelect(serverId: string): Promise<void>;
}) {
  const [busyServerId, setBusyServerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const select = async (serverId: string) => {
    if (busyServerId !== null) return;
    setBusyServerId(serverId);
    setError(null);
    try {
      await onSelect(serverId);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create thread");
    }
    setBusyServerId(null);
  };
  return (
    <AppSheet
      isOpen={visible}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      contentProps={{ dismissLabel: "Close new thread", index: 0, enableDynamicSizing: true }}
    >
      <View style={styles.menuTitleRow}>
        <Text style={styles.sheetTitle}>Choose server</Text>
        <View style={styles.flex} />
      </View>
      <AppSheetScrollView
        style={styles.menuScroll}
        contentContainerStyle={styles.menuScrollContent}
      >
        {servers.map((server, index) => (
          <ControlOption
            key={server.id}
            position={listRowPosition(index, servers.length)}
            title={`${server.emoji} ${server.name}`}
            subtitle={
              busyServerId === server.id ? "Creating…" : connectionStateLabel(server.status)
            }
            selected={false}
            onPress={() => void select(server.id)}
          />
        ))}
        {error !== null && <Text style={styles.errorText}>{error}</Text>}
      </AppSheetScrollView>
    </AppSheet>
  );
}
