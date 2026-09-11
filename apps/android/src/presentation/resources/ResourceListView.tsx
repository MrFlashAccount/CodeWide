import type { ReactNode } from "react";
import {
  Pressable,
  type PressableStateCallbackType,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { colors, radii, spacing, typeScale, layoutSize } from "../../theme";
import { ProductText } from "../text/ProductText";

export interface ResourceListRow {
  accessibilityLabel?: string;
  detail?: string;
  id: string;
  label: string;
  onPress?: () => void;
  trailing?: ReactNode;
}

interface ResourceListViewProps {
  empty: string;
  rows: ResourceListRow[];
}

export function ResourceListView(props: ResourceListViewProps): React.JSX.Element {
  const { empty, rows } = props;
  return (
    <ScrollView contentContainerStyle={rows.length === 0 ? styles.emptyContent : styles.content}>
      {rows.length === 0 ? (
        <ProductText style={styles.empty} tone="muted">
          {empty}
        </ProductText>
      ) : null}
      {rows.map((row) => {
        const body = (
          <>
            <View style={styles.copy}>
              <ProductText numberOfLines={2} style={styles.label} weight="semibold">
                {row.label}
              </ProductText>
              {row.detail === undefined ? null : (
                <ProductText numberOfLines={2} style={styles.detail} tone="muted">
                  {row.detail}
                </ProductText>
              )}
            </View>
            {row.trailing}
            {row.onPress === undefined ? null : (
              <ProductText style={styles.chevron} tone="muted">
                ›
              </ProductText>
            )}
          </>
        );
        return row.onPress === undefined ? (
          <View key={row.id} style={styles.row}>
            {body}
          </View>
        ) : (
          <Pressable
            accessibilityLabel={row.accessibilityLabel ?? row.label}
            accessibilityRole="button"
            key={row.id}
            onPress={row.onPress}
            style={resourceRowStyle}
          >
            {body}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function resourceRowStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.row, pressed && styles.pressed];
}

const styles = StyleSheet.create({
  chevron: { ...typeScale.heading },
  content: { gap: spacing.xs, padding: spacing.md },
  copy: { flex: 1, gap: spacing.xxs, minWidth: 0 },
  detail: { ...typeScale.label },
  empty: { textAlign: "center" },
  emptyContent: { flexGrow: 1, justifyContent: "center", padding: spacing.lg },
  label: { ...typeScale.body },
  pressed: { opacity: 0.68 },
  row: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radii.selected,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: layoutSize.row,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.inputInset,
  },
});
