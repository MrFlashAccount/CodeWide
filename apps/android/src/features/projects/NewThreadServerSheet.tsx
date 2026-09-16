import { useState } from "react";
import { View } from "react-native";
import { listRowPosition } from "../../ui/AppListRow.types";
import { AppSheet, AppSheetScrollView } from "../../ui/AppSheet";
import { ControlOption } from "../../ui/ControlOption";
import { AppText as Text } from "../../ui/Typography";
import { connectionStateLabel, type ThreadListServer } from "../connections/connectionPresentation";
import { styles } from "./NewThreadServerSheet.styles";

export function NewThreadServerSheet({
  onClose,
  onSelect,
  servers,
  visible,
}: {
  onClose: () => void;
  onSelect: (serverId: string) => Promise<void>;
  servers: ThreadListServer[];
  visible: boolean;
}) {
  const [busyServerId, setBusyServerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const select = async (serverId: string) => {
    if (busyServerId !== null) {
      return;
    }
    setBusyServerId(serverId);
    setError(null);
    try {
      await onSelect(serverId);
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not create thread");
    }
    setBusyServerId(null);
  };
  return (
    <AppSheet
      contentProps={{ dismissLabel: "Close new thread", enableDynamicSizing: true, index: 0 }}
      isOpen={visible}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <View style={styles.menuTitleRow}>
        <Text style={styles.sheetTitle}>Choose server</Text>
        <View style={styles.flex} />
      </View>
      <AppSheetScrollView
        contentContainerStyle={styles.menuScrollContent}
        style={styles.menuScroll}
      >
        {servers.map((server, index) => (
          <ControlOption
            key={server.id}
            onPress={() => void select(server.id)}
            position={listRowPosition(index, servers.length)}
            selected={false}
            subtitle={
              busyServerId === server.id ? "Creating…" : connectionStateLabel(server.status)
            }
            title={`${server.emoji} ${server.name}`}
          />
        ))}
        {error !== null && <Text style={styles.errorText}>{error}</Text>}
      </AppSheetScrollView>
    </AppSheet>
  );
}
