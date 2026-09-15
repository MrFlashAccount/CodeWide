import type { BackgroundTerminalValue } from "../../data/workspace-resource-database";
import { useBackgroundTerminalActions } from "./backgroundTerminalActions";
/** V1 backgroundTerminals owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, View } from "react-native";
import { type BackgroundTerminalsRow } from "../../data/workspace-resource-database";
import { colors, iconSize } from "../../theme";
import { AppListRow } from "../../ui/AppListRow";
import { listRowStyles } from "../../ui/AppListRow.styles";
import { listRowHeight } from "../../ui/AppListRow.types";
import { AppSheet, AppSheetScrollView } from "../../ui/AppSheet";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./backgroundTerminals.styles";

export function BackgroundTerminalsSheet({
  visible,
  onClose,
  embedded = false,
  resource,
  onList,
  onTerminate,
}: {
  visible: boolean;
  onClose(): void;
  embedded?: boolean;
  resource: BackgroundTerminalsRow | null;
  onList?(): Promise<BackgroundTerminalValue[]>;
  onTerminate?(processId: string): Promise<boolean>;
}) {
  const { busyId, error, reload, terminate } = useBackgroundTerminalActions(onList, onTerminate);
  const items = resource?.items ?? [];
  const effectiveError = error ?? resource?.error ?? null;
  const content = (
    <>
      {!embedded && (
        <View style={styles.menuTitleRow}>
          <Text style={styles.sheetTitle}>Background terminals</Text>
          <View style={styles.flex} />
          <Pressable
            accessibilityLabel="Refresh terminals"
            onPress={() => void reload()}
            style={styles.headerIcon}
          >
            <Ionicons name="refresh" size={iconSize.action} color={colors.text} />
          </Pressable>
        </View>
      )}
      {items.length === 0 && (
        <Text style={styles.menuNotice}>No background processes in this thread.</Text>
      )}
      <AppSheetScrollView
        style={styles.menuScroll}
        contentContainerStyle={styles.menuScrollContent}
      >
        {items.map((item) => (
          <View key={item.processId}>
            {/* Native ListItem text is not selectable; retain copying commands and paths. */}
            <View style={[listRowStyles.surface, listRowStyles.first, listRowStyles.row]}>
              <Ionicons name="terminal-outline" size={iconSize.action} color={colors.textMuted} />
              <View style={listRowStyles.text}>
                <Text selectable numberOfLines={3} style={listRowStyles.title}>
                  {item.command}
                </Text>
                <Text selectable style={listRowStyles.description}>
                  {item.cwd} · PID {item.osPid ?? item.processId}
                </Text>
              </View>
              <View style={listRowStyles.separator} />
            </View>
            <AppListRow
              title={`${item.cpuPercent === null ? "CPU —" : `CPU ${item.cpuPercent.toFixed(1)}%`} · ${item.rssKb === null ? "RAM —" : `RAM ${item.rssKb} KiB`}`}
              fixedHeight={listRowHeight.single}
              position="last"
              trailing={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Terminate ${item.processId}`}
                  disabled={busyId !== null || onTerminate === undefined}
                  onPress={() => void terminate(item.processId)}
                  style={styles.headerIcon}
                >
                  {busyId === item.processId ? (
                    <ActivityIndicator color={colors.red} size="small" />
                  ) : (
                    <Ionicons
                      name="stop-circle-outline"
                      size={iconSize.action}
                      color={colors.red}
                    />
                  )}
                </Pressable>
              }
            />
          </View>
        ))}
      </AppSheetScrollView>
      {effectiveError !== null && <Text style={styles.errorText}>{effectiveError}</Text>}
    </>
  );
  return embedded ? (
    content
  ) : (
    <AppSheet
      isOpen={visible}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      contentProps={{
        dismissLabel: "Close terminals",
        index: 0,
        snapPoints: ["55%", "90%"],
        enableDynamicSizing: false,
        enableOverDrag: false,
        contentContainerClassName: "h-full",
      }}
    >
      {content}
    </AppSheet>
  );
}
