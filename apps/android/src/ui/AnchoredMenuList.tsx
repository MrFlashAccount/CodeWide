import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { colors, menuContentInset, radii, spacing, typeScale } from "../theme";
import { MENU_ROW_MIN_HEIGHT } from "./menuGeometry";
import { AppText as Text } from "./Typography";

/**
 * The body of an anchored list menu: an optional quiet heading and rows, with
 * the native menu's geometry. `ContentMenu` sizes the popup to it and scrolls
 * it; the list itself has no height of its own.
 */
export function AnchoredMenuList({
  children,
  testID,
  title,
}: {
  readonly children: ReactNode;
  readonly testID: string;
  readonly title?: string;
}): React.JSX.Element {
  return (
    <View testID={testID}>
      {title === undefined ? null : (
        <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
          {title}
        </Text>
      )}
      {children}
    </View>
  );
}

/** One pressable row of an anchored list menu, as the native menu draws its items. */
export function AnchoredMenuRow({
  accessibilityLabel,
  children,
  disabled = false,
  onPress,
  testID,
}: {
  readonly accessibilityLabel: string;
  readonly children: ReactNode;
  /** A row that opens nothing. */
  readonly disabled?: boolean;
  readonly onPress: () => void;
  readonly testID: string;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      testID={testID}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    borderRadius: radii.selected,
    flexDirection: "row",
    gap: spacing.sm,
    marginHorizontal: spacing.xs,
    minHeight: MENU_ROW_MIN_HEIGHT,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  rowPressed: {
    backgroundColor: colors.menuHighlight,
  },
  title: {
    color: colors.textDim,
    ...typeScale.label,
    paddingBottom: spacing.xxs,
    paddingHorizontal: menuContentInset,
    paddingTop: spacing.xs,
  },
});
