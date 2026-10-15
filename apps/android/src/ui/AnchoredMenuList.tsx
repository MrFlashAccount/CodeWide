import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { colors, menuContentInset, radii, spacing, typeScale } from "../theme";
import { AppText as Text } from "./Typography";

/**
 * The body of an anchored list menu, like the live plan's: a clipped rounded
 * surface, a quiet heading and scrolling rows bounded by `maxHeight`.
 */
export function AnchoredMenuList({
  children,
  maxHeight,
  testID,
  title,
}: {
  readonly children: ReactNode;
  readonly maxHeight: number;
  readonly testID: string;
  readonly title: string;
}): React.JSX.Element {
  return (
    <View style={[styles.menu, { maxHeight }]}>
      <ScrollView
        contentContainerStyle={styles.list}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        style={{ maxHeight }}
        testID={testID}
      >
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.xxs,
    paddingHorizontal: menuContentInset,
    paddingVertical: spacing.xs,
  },
  menu: {
    borderRadius: radii.large,
    overflow: "hidden",
  },
  title: {
    color: colors.textMuted,
    ...typeScale.label,
  },
});
