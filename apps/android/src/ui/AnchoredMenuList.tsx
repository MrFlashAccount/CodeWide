import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { colors, menuContentInset, radii, spacing, typeScale } from "../theme";
import { AppText as Text } from "./Typography";

/** Space between rows and around the list, for menus that declare their height. */
export const LIST_GAP = spacing.xxs;
export const LIST_PADDING = spacing.xs;

/**
 * How tall the list is: measured from its rows up to `maxHeight`, or a
 * declared `height` for rows of fixed height, which the anchored popup then
 * does not have to measure.
 */
type ListHeight =
  | { readonly height?: never; readonly maxHeight: number }
  | { readonly height: number; readonly maxHeight?: never };

/**
 * The body of an anchored list menu, like the live plan's: a clipped rounded
 * surface, an optional quiet heading and scrolling rows.
 */
export function AnchoredMenuList({
  children,
  testID,
  title,
  ...size
}: ListHeight & {
  readonly children: ReactNode;
  readonly testID: string;
  readonly title?: string;
}): React.JSX.Element {
  const bound = size.height === undefined ? { maxHeight: size.maxHeight } : { height: size.height };
  return (
    <View style={[styles.menu, bound]}>
      <ScrollView
        contentContainerStyle={styles.list}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        style={bound}
        testID={testID}
      >
        {title === undefined ? null : (
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
        )}
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: LIST_GAP,
    paddingHorizontal: menuContentInset,
    paddingVertical: LIST_PADDING,
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
