import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, View, type ViewStyle } from "react-native";

import { useEvent } from "../../../react/useEvent";
import type { TerminalSessionStatus } from "../../domain/terminalSession";
import { colors, spacing, touchTarget, typeScale } from "../../theme";
import { ProductText as Text } from "../text/ProductText";

export interface TerminalTabViewModel {
  active: boolean;
  exitCode: number | null;
  id: string;
  signal: string | null;
  status: TerminalSessionStatus;
  title: string;
}

interface TerminalTabBarViewProps {
  actionsDisabled: boolean;
  canCreate: boolean;
  onClose(id: string): void;
  onCreate(): void;
  onMinimize(): void;
  onSelect(id: string): void;
  onToggleBackgrounds(): void;
  sessionsTotal: number;
  tabs: readonly TerminalTabViewModel[];
}

interface TerminalTabButtonProps {
  actionsDisabled: boolean;
  model: TerminalTabViewModel;
  onClose(id: string): void;
  onSelect(id: string): void;
}

interface HeaderButtonProps {
  accessibilityLabel: string;
  disabled?: boolean;
  icon: "add" | "albums-outline" | "chevron-down";
  onPress(): void;
}

export function TerminalTabBarView(props: TerminalTabBarViewProps): React.JSX.Element {
  const {
    actionsDisabled,
    canCreate,
    onCreate,
    onMinimize,
    onToggleBackgrounds,
    sessionsTotal,
    tabs,
  } = props;
  return (
    <View style={styles.header}>
      <ScrollView
        contentContainerStyle={styles.tabList}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabScroll}
      >
        {tabs.map((tab) => (
          <TerminalTabButton
            actionsDisabled={actionsDisabled}
            key={tab.id}
            model={tab}
            onClose={props.onClose}
            onSelect={props.onSelect}
          />
        ))}
      </ScrollView>
      <HeaderButton
        accessibilityLabel={`Background processes: ${sessionsTotal}`}
        icon="albums-outline"
        onPress={onToggleBackgrounds}
      />
      <HeaderButton
        accessibilityLabel="New terminal tab"
        disabled={!canCreate}
        icon="add"
        onPress={onCreate}
      />
      <HeaderButton
        accessibilityLabel="Minimize terminal"
        icon="chevron-down"
        onPress={onMinimize}
      />
    </View>
  );
}

function TerminalTabButton(props: TerminalTabButtonProps): React.JSX.Element {
  const { actionsDisabled, model, onClose, onSelect } = props;
  const lifecycle = terminalLifecycleLabel(model);
  const select = useEvent(() => onSelect(model.id));
  const close = useEvent(() => onClose(model.id));
  return (
    <View style={[styles.tab, model.active && styles.activeTab]}>
      <Pressable
        accessibilityLabel={model.title}
        accessibilityRole="tab"
        accessibilityState={{ selected: model.active }}
        accessibilityValue={{ text: lifecycle }}
        onPress={select}
        style={styles.tabSelect}
        testID={`terminal-tab-${model.id}`}
      >
        <View
          accessibilityElementsHidden
          style={[styles.statusDot, statusDotStyle(model.status)]}
        />
        <View style={styles.tabLabels}>
          <Text numberOfLines={1} style={[styles.tabText, model.active && styles.activeTabText]}>
            {model.title}
          </Text>
          <Text
            numberOfLines={1}
            style={styles.statusText}
            testID={model.active ? "v2-terminal-active-status" : undefined}
          >
            {lifecycle}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityLabel={`Close ${model.title}`}
        accessibilityRole="button"
        accessibilityState={{ disabled: actionsDisabled }}
        disabled={actionsDisabled}
        hitSlop={8}
        onPress={close}
        style={[styles.tabClose, actionsDisabled && styles.disabled]}
      >
        <Ionicons color={colors.textMuted} name="close" size={16} />
      </Pressable>
    </View>
  );
}

function terminalLifecycleLabel(
  model: Pick<TerminalTabViewModel, "exitCode" | "signal" | "status">,
): string {
  if (model.status === "connecting") return "Connecting";
  if (model.status === "live") return "Live";
  if (model.status === "failed") return "Failed";
  if (model.signal !== null) return `Exited · ${model.signal}`;
  if (model.exitCode !== null) return `Exited · code ${String(model.exitCode)}`;
  return "Exited";
}

function HeaderButton(props: HeaderButtonProps): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={props.accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled === true }}
      disabled={props.disabled === true}
      onPress={props.onPress}
      style={[styles.headerButton, props.disabled === true && styles.disabled]}
    >
      <Ionicons
        color={colors.text}
        name={props.icon}
        size={props.icon === "chevron-down" ? 24 : 20}
      />
    </Pressable>
  );
}

function statusDotStyle(status: TerminalSessionStatus): ViewStyle {
  if (status === "live") return styles.statusLive;
  if (status === "failed") return styles.statusError;
  return styles.statusIdle;
}

const styles = StyleSheet.create({
  activeTab: { backgroundColor: colors.surfaceRaised },
  activeTabText: { color: colors.text },
  disabled: { opacity: 0.4 },
  header: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 48,
    paddingHorizontal: spacing.xs,
  },
  headerButton: {
    alignItems: "center",
    borderRadius: touchTarget / 2,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  statusDot: { borderRadius: 4, height: 7, width: 7 },
  statusError: { backgroundColor: colors.red },
  statusIdle: { backgroundColor: colors.textDim },
  statusLive: { backgroundColor: colors.green },
  tab: {
    alignItems: "center",
    backgroundColor: colors.surfaceHover,
    borderRadius: 10,
    flexDirection: "row",
    height: 34,
    maxWidth: 190,
  },
  tabClose: {
    alignItems: "center",
    borderRadius: 8,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  tabList: { alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.xs },
  tabLabels: { flex: 1, minWidth: 0 },
  tabScroll: { flex: 1, minWidth: 0 },
  tabSelect: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
    height: "100%",
    minWidth: 80,
    paddingLeft: spacing.sm,
  },
  tabText: { color: colors.textMuted, flexShrink: 1, ...typeScale.label },
  statusText: { color: colors.textDim, ...typeScale.caption },
});
