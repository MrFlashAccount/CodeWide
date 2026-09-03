import { Pressable, type PressableStateCallbackType, StyleSheet, View } from "react-native";

import { colors, radii, spacing, typeScale } from "../../theme";
import { ActionMenu, type ActionMenuItem } from "../../ui/ActionMenu";
import { PresentationIcon } from "../icons/PresentationIcon";
import { VoiceTextInputView } from "../input/VoiceTextInputView";
import { PresentationTextInput as TextInput } from "../text/ProductText";
import type { ThreadListFilter, ThreadListVoiceControl } from "./threadListTypes";

const FILTER_ITEMS: ActionMenuItem[] = [
  { id: "all", label: "All threads" },
  { id: "running", label: "Running" },
  { id: "approval", label: "Approval needed" },
  { id: "unread", label: "Unread" },
  { id: "pinned", label: "Pinned" },
];

interface ThreadListToolbarProps {
  filter: ThreadListFilter;
  onChangeQuery(value: string): void;
  onSelectFilter(id: string): void;
  query: string;
  voice?: ThreadListVoiceControl;
}

export function ThreadListToolbar(props: ThreadListToolbarProps): React.JSX.Element {
  const { filter, onChangeQuery, onSelectFilter, query, voice } = props;
  return (
    <View style={styles.searchRow}>
      <View style={styles.searchBox}>
        <PresentationIcon color={colors.textMuted} name="search" size={18} />
        <View style={styles.searchInputSlot}>
          {voice === undefined ? (
            <TextInput
              accessibilityLabel="Search threads"
              onChangeText={onChangeQuery}
              placeholder="Search threads"
              placeholderTextColor={colors.textDim}
              style={styles.searchInput}
              value={query}
            />
          ) : (
            <VoiceTextInputView
              accessibilityLabel="Search threads"
              onChangeText={onChangeQuery}
              placeholder="Search threads"
              placeholderTextColor={colors.textDim}
              style={styles.searchInput}
              value={query}
              voice={voice}
            />
          )}
        </View>
      </View>
      <ActionMenu
        accessibilityLabel="Thread filters"
        actions={filterActions(filter)}
        align="end"
        menuWidth={220}
        onSelect={onSelectFilter}
        placement="bottom"
      >
        <Pressable
          accessibilityLabel="Thread filters"
          accessibilityRole="button"
          accessibilityState={{ selected: filter !== "all" }}
          style={filterButtonStyle}
        >
          <PresentationIcon color={colors.text} name="filter" size={20} />
        </Pressable>
      </ActionMenu>
    </View>
  );
}

function filterActions(filter: ThreadListFilter): ActionMenuItem[] {
  return FILTER_ITEMS.map((item) => ({ ...item, selected: item.id === filter }));
}

function filterButtonStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.filterButton, pressed && styles.pressed];
}

const styles = StyleSheet.create({
  filterButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.large,
    height: 44,
    justifyContent: "center",
    width: 40,
  },
  pressed: { opacity: 0.68 },
  searchBox: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.large,
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
    height: 44,
    minWidth: 0,
    paddingHorizontal: spacing.sm,
  },
  searchInput: {
    color: colors.text,
    flex: 1,
    ...typeScale.body,
    minWidth: 0,
    paddingVertical: 0,
    width: "100%",
  },
  searchInputSlot: { alignSelf: "stretch", flex: 1, minHeight: 40, minWidth: 0 },
  searchRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
});
