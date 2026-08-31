import type { PropsWithChildren, ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { colors, spacing, typeScale } from "../../theme";
import { ProductText } from "../text/ProductText";

export function WorkspaceView({
  actions,
  children,
  leading,
  subtitle,
  title,
}: PropsWithChildren<{
  actions?: ReactNode;
  leading?: ReactNode;
  subtitle?: ReactNode;
  title: string;
}>): React.JSX.Element {
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        {leading === undefined ? null : <View style={styles.leading}>{leading}</View>}
        <View style={styles.identity}>
          <ProductText
            accessibilityRole="header"
            numberOfLines={1}
            style={styles.title}
            weight="semibold"
          >
            {title}
          </ProductText>
          {subtitle === undefined ? null : <View style={styles.subtitle}>{subtitle}</View>}
        </View>
        {actions === undefined ? null : <View style={styles.actions}>{actions}</View>}
      </View>
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { alignItems: "center", flexDirection: "row" },
  content: { flex: 1, minHeight: 0 },
  header: {
    alignItems: "center",
    backgroundColor: colors.surface,
    flexDirection: "row",
    minHeight: 56,
    paddingLeft: spacing.xs,
  },
  identity: { flex: 1, minWidth: 0, paddingHorizontal: spacing.xs },
  leading: { alignItems: "center", justifyContent: "center" },
  root: { backgroundColor: colors.background, flex: 1 },
  subtitle: { marginTop: 1 },
  title: { ...typeScale.titleMedium },
});
