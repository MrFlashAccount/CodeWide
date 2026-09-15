import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, View } from "react-native";
import {
  closeInteractiveTerminalTab,
  createInteractiveTerminalTab,
  selectInteractiveTerminalTab,
  useInteractiveTerminalWorkspace,
  type InteractiveTerminalTab,
} from "../../data/interactive-terminal-store";
import { colors, iconSize } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import { TerminalTab } from "./TerminalTab.native";
import { styles } from "./TerminalWorkspace.styles";

export const MAX_TABS = 8;

/** Hosts native terminal sessions for the active server and thread. */
export function TerminalWorkspace({
  connectionId,
  threadId,
  cwd,
  onMinimize,
}: {
  connectionId: string;
  threadId: string;
  cwd: string | null;
  onMinimize(): void;
}) {
  const workspace = useInteractiveTerminalWorkspace(connectionId, threadId);
  const active =
    workspace.tabs.find(({ id }) => id === workspace.activeId) ?? workspace.tabs[0] ?? null;
  const createTab = () => createInteractiveTerminalTab({ connectionId, threadId, cwd });

  return (
    <View testID="terminal-workspace" style={styles.root}>
      <View style={styles.header}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabList}
          style={styles.tabScroll}
        >
          {workspace.tabs.map((tab) => (
            <View key={tab.id} style={[styles.tab, tab.id === active?.id && styles.activeTab]}>
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: tab.id === active?.id }}
                accessibilityLabel={tab.title}
                onPress={() => selectInteractiveTerminalTab(connectionId, threadId, tab.id)}
                style={styles.tabSelect}
              >
                <View style={[styles.statusDot, statusDotStyle(tab.status)]} />
                <Text
                  numberOfLines={1}
                  style={[styles.tabText, tab.id === active?.id && styles.activeTabText]}
                >
                  {tab.title}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Close ${tab.title}`}
                hitSlop={8}
                onPress={() => closeInteractiveTerminalTab(connectionId, threadId, tab.id)}
                style={({ pressed }) => [styles.tabClose, pressed && styles.pressed]}
              >
                <Ionicons name="close" size={iconSize.inline} color={colors.textMuted} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New terminal tab"
          accessibilityState={{ disabled: workspace.tabs.length >= MAX_TABS }}
          disabled={workspace.tabs.length >= MAX_TABS}
          onPress={createTab}
          style={({ pressed }) => [
            styles.newTab,
            pressed && styles.pressed,
            workspace.tabs.length >= MAX_TABS && styles.disabled,
          ]}
        >
          <Ionicons name="add" size={iconSize.action} color={colors.text} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Minimize terminal"
          onPress={onMinimize}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-down" size={iconSize.navigation} color={colors.text} />
        </Pressable>
      </View>

      {active === null ? (
        <View style={styles.empty}>
          <Ionicons name="terminal-outline" size={iconSize.illustration} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No terminal tabs</Text>
          <Pressable
            accessibilityRole="button"
            onPress={createTab}
            style={({ pressed }) => [styles.createButton, pressed && styles.pressed]}
          >
            <Ionicons name="add" size={iconSize.action} color={colors.onPrimary} />
            <Text style={styles.createButtonText}>New terminal</Text>
          </Pressable>
        </View>
      ) : (
        <TerminalTab key={active.id} tab={active} />
      )}
    </View>
  );
}

export function statusDotStyle(status: InteractiveTerminalTab["status"]) {
  if (status === "open") return styles.statusLive;
  if (status === "error") return styles.statusError;
  return styles.statusIdle;
}
