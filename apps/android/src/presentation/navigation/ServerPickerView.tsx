import {
  Pressable,
  type PressableStateCallbackType,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { colors, radii, spacing, touchTarget } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";
import type { ServerRailRow } from "./ServerRailView";
import { useEvent } from "../../react/useEvent";

interface ServerPickerViewProps {
  onAdd(): void;
  onOpen(id: string): void;
  rows: ServerRailRow[];
}

interface ServerPickerRowProps {
  onOpen(id: string): void;
  row: ServerRailRow;
}

export function ServerPickerView(props: ServerPickerViewProps): React.JSX.Element {
  const { onAdd, onOpen, rows } = props;
  return (
    <ScrollView contentContainerStyle={styles.list}>
      {rows.map((row) => (
        <ServerPickerRow key={row.id} onOpen={onOpen} row={row} />
      ))}
      <Pressable
        accessibilityLabel="Add server"
        accessibilityRole="button"
        onPress={onAdd}
        style={addButtonStyle}
      >
        <PresentationIcon color={colors.text} name="add" size={22} />
        <ProductText weight="semibold">Add server</ProductText>
      </Pressable>
    </ScrollView>
  );
}

function ServerPickerRow(props: ServerPickerRowProps): React.JSX.Element {
  const { onOpen, row } = props;
  const open = useEvent(() => onOpen(row.id));
  return (
    <Pressable
      accessibilityLabel={`Open ${row.label}`}
      accessibilityRole="button"
      onPress={open}
      style={serverRowStyle}
    >
      <View style={styles.avatar}>
        <ProductText style={styles.emoji}>{row.emoji}</ProductText>
      </View>
      <View style={styles.copy}>
        <ProductText numberOfLines={1} style={styles.label} weight="semibold">
          {row.label}
        </ProductText>
        <ProductText tone={row.detail === "Enabled" ? "success" : "muted"}>
          {row.detail}
        </ProductText>
      </View>
      <ProductText style={styles.chevron} tone="muted">
        ›
      </ProductText>
    </Pressable>
  );
}

function addButtonStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.add, pressed && styles.pressed];
}

function serverRowStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.row, pressed && styles.pressed];
}

const styles = StyleSheet.create({
  add: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.large,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  chevron: { fontSize: 28, lineHeight: 30 },
  copy: { flex: 1, gap: 2, minWidth: 0 },
  emoji: { fontSize: 22, lineHeight: 28 },
  label: { fontSize: 16, lineHeight: 22 },
  list: { gap: spacing.xs, padding: spacing.md },
  pressed: { opacity: 0.68 },
  row: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radii.selected,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 68,
    padding: 10,
  },
});
