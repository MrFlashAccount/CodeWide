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
  cwd,
  onMinimize,
  threadId,
}: {
  connectionId: string;
  cwd: string | null;
  onMinimize: () => void;
  threadId: string;
}) {
  const workspace = useInteractiveTerminalWorkspace(connectionId, threadId);
  const active =
    workspace.tabs.find(({ id }) => id === workspace.activeId) ?? workspace.tabs[0] ?? null;
  const createTab = (): void => {
    createInteractiveTerminalTab({ connectionId, cwd, threadId });
  };

  return (
    <View style={styles.root} testID="terminal-workspace">
      <View style={styles.header}>
        <ScrollView
          contentContainerStyle={styles.tabList}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabScroll}
        >
          {workspace.tabs.map((tab) => (
            <View key={tab.id} style={[styles.tab, tab.id === active?.id && styles.activeTab]}>
              <Pressable
                accessibilityLabel={tab.title}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab.id === active?.id }}
                onPress={() => {
                  selectInteractiveTerminalTab(connectionId, threadId, tab.id);
                }}
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
                accessibilityLabel={`Close ${tab.title}`}
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => {
                  closeInteractiveTerminalTab(connectionId, threadId, tab.id);
                }}
                style={({ pressed }) => [styles.tabClose, pressed && styles.pressed]}
              >
                <Ionicons color={colors.textMuted} name="close" size={iconSize.inline} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
        <Pressable
          accessibilityLabel="New terminal tab"
          accessibilityRole="button"
          accessibilityState={{ disabled: workspace.tabs.length >= MAX_TABS }}
          disabled={workspace.tabs.length >= MAX_TABS}
          onPress={createTab}
          style={({ pressed }) => [
            styles.newTab,
            pressed && styles.pressed,
            workspace.tabs.length >= MAX_TABS && styles.disabled,
          ]}
        >
          <Ionicons color={colors.text} name="add" size={iconSize.action} />
        </Pressable>
        <Pressable
          accessibilityLabel="Minimize terminal"
          accessibilityRole="button"
          onPress={onMinimize}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
        >
          <Ionicons color={colors.text} name="chevron-down" size={iconSize.navigation} />
        </Pressable>
      </View>

      {active === null ? (
        <View style={styles.empty}>
          <Ionicons color={colors.textMuted} name="terminal-outline" size={iconSize.illustration} />
          <Text style={styles.emptyTitle}>No terminal tabs</Text>
          <Pressable
            accessibilityRole="button"
            onPress={createTab}
            style={({ pressed }) => [styles.createButton, pressed && styles.pressed]}
          >
            <Ionicons color={colors.onPrimary} name="add" size={iconSize.action} />
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
  if (status === "open") {
    return styles.statusLive;
  }
  if (status === "error") {
    return styles.statusError;
  }
  return styles.statusIdle;
}
