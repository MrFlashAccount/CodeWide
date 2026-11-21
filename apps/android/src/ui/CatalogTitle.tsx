import type { ReactNode } from "react";
import { StyleSheet, type StyleProp, type TextStyle } from "react-native";

import { colors, typeScale } from "../theme";
import { AppText as Text } from "./Typography";

/** The only style a caller may add: its flex placement. */
type CatalogTitleLayout = Pick<
  TextStyle,
  "alignSelf" | "flex" | "flexGrow" | "flexShrink" | "minWidth"
>;

/**
 * The title of a top-level catalog header (Threads, Pull requests). Every
 * catalog uses this one typographic role, so switching catalogs never changes
 * the title's size, weight or line height; callers pass layout only.
 */
export function CatalogTitle({
  children,
  layout,
  testID,
}: {
  readonly children: ReactNode;
  /** Flex placement in the caller's header row; the type admits no typography. */
  readonly layout?: StyleProp<CatalogTitleLayout>;
  readonly testID?: string;
}): React.JSX.Element {
  return (
    <Text
      accessibilityRole="header"
      ellipsizeMode="tail"
      numberOfLines={1}
      style={[styles.title, layout]}
      testID={testID}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typeScale.title,
    color: colors.text,
  },
});
