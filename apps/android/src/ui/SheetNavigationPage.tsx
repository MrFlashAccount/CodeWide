import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { colors, iconSize, spacing, touchTarget, typeScale } from "../theme";
import { AppSheetScrollView } from "./AppSheet";
import { AppText } from "./Typography";

/** Standard settings page with a fixed heading and one keyboard-aware scroll surface. */
export function SheetNavigationPage({
  action,
  back,
  children,
  title,
}: {
  readonly action?: ReactNode;
  readonly back?: { readonly label: string; readonly onPress: () => void };
  readonly children: ReactNode;
  readonly title: string;
}): React.JSX.Element {
  const backControl =
    back === undefined ? null : (
      <Pressable
        accessibilityLabel={back.label}
        accessibilityRole="button"
        onPress={back.onPress}
        style={styles.back}
      >
        <Ionicons color={colors.text} name="arrow-back" size={iconSize.action} />
      </Pressable>
    );
  return (
    <>
      <View style={styles.header}>
        {backControl}
        <AppText accessibilityRole="header" numberOfLines={1} style={styles.title}>
          {title}
        </AppText>
        {action}
      </View>
      <AppSheetScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        style={styles.scroll}
      >
        {children}
      </AppSheetScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  back: {
    alignItems: "center",
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  content: {
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.compact,
    marginBottom: spacing.xs,
    minHeight: touchTarget,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  title: {
    color: colors.text,
    flex: 1,
    minWidth: 0,
    ...typeScale.heading,
  },
});
