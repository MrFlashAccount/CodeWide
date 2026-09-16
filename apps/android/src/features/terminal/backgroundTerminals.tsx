import type { BackgroundTerminalValue } from "../../data/workspace-resource-database";
import { useBackgroundTerminalActions } from "./backgroundTerminalActions";
/** V1 backgroundTerminals owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, View } from "react-native";
import type { BackgroundTerminalsRow } from "../../data/workspace-resource-database";
import { colors, iconSize } from "../../theme";
import { AppListRow } from "../../ui/AppListRow";
import { listRowStyles } from "../../ui/AppListRow.styles";
import { listRowHeight } from "../../ui/AppListRow.types";
import { AppSheet, AppSheetScrollView } from "../../ui/AppSheet";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./backgroundTerminals.styles";

export function BackgroundTerminalsSheet({
  embedded = false,
  onClose,
  onList,
  onTerminate,
  resource,
  visible,
}: {
  embedded?: boolean;
  onClose: () => void;
  onList?: () => Promise<BackgroundTerminalValue[]>;
  onTerminate?: (processId: string) => Promise<boolean>;
  resource: BackgroundTerminalsRow | null;
  visible: boolean;
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
            <Ionicons color={colors.text} name="refresh" size={iconSize.action} />
          </Pressable>
        </View>
      )}
      {items.length === 0 && (
        <Text style={styles.menuNotice}>No background processes in this thread.</Text>
      )}
      <AppSheetScrollView
        contentContainerStyle={styles.menuScrollContent}
        style={styles.menuScroll}
      >
        {items.map((item) => (
          <View key={item.processId}>
            {/* Native ListItem text is not selectable; retain copying commands and paths. */}
            <View style={[listRowStyles.surface, listRowStyles.first, listRowStyles.row]}>
              <Ionicons color={colors.textMuted} name="terminal-outline" size={iconSize.action} />
              <View style={listRowStyles.text}>
                <Text numberOfLines={3} selectable style={listRowStyles.title}>
                  {item.command}
                </Text>
                <Text selectable style={listRowStyles.description}>
                  {item.cwd} · PID {item.osPid ?? item.processId}
                </Text>
              </View>
              <View style={listRowStyles.separator} />
            </View>
            <AppListRow
              fixedHeight={listRowHeight.single}
              position="last"
              title={`${item.cpuPercent === null ? "CPU —" : `CPU ${item.cpuPercent.toFixed(1)}%`} · ${item.rssKb === null ? "RAM —" : `RAM ${item.rssKb} KiB`}`}
              trailing={
                <Pressable
                  accessibilityLabel={`Terminate ${item.processId}`}
                  accessibilityRole="button"
                  disabled={busyId !== null || onTerminate === undefined}
                  onPress={() => void terminate(item.processId)}
                  style={styles.headerIcon}
                >
                  {busyId === item.processId ? (
                    <ActivityIndicator color={colors.red} size="small" />
                  ) : (
                    <Ionicons
                      color={colors.red}
                      name="stop-circle-outline"
                      size={iconSize.action}
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
      contentProps={{
        contentContainerClassName: "h-full",
        dismissLabel: "Close terminals",
        enableDynamicSizing: false,
        enableOverDrag: false,
        index: 0,
        snapPoints: ["55%", "90%"],
      }}
      isOpen={visible}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      {content}
    </AppSheet>
  );
}
