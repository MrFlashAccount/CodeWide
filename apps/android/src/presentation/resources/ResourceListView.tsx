import type { ReactNode } from "react";
import {
  Pressable,
  type PressableStateCallbackType,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { colors, radii, spacing } from "../../theme";
import { ProductText } from "../text/ProductText";

export interface ResourceListRow {
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

export function ResourceListView({ empty, rows }: ResourceListViewProps): React.JSX.Element {
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
            accessibilityLabel={row.label}
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

function resourceRowStyle({ pressed }: PressableStateCallbackType) {
  return [styles.row, pressed && styles.pressed];
}

const styles = StyleSheet.create({
  chevron: { fontSize: 25, lineHeight: 28 },
  content: { gap: spacing.xs, padding: spacing.md },
  copy: { flex: 1, gap: 3, minWidth: 0 },
  detail: { fontSize: 12, lineHeight: 17 },
  empty: { textAlign: "center" },
  emptyContent: { flexGrow: 1, justifyContent: "center", padding: spacing.lg },
  label: { fontSize: 14, lineHeight: 19 },
  pressed: { opacity: 0.68 },
  row: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radii.selected,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 64,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
  },
});
