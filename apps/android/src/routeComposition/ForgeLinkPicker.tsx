import type { ReactNode } from "react";
import { StyleSheet } from "react-native";

import type { ForgeLinkTarget } from "../data/forgeLinkTargets";
import { useEvent } from "../react/useEvent";
import { colors, spacing, typeScale } from "../theme";
import { AppSheet, AppSheetScrollView } from "../ui/AppSheet";
import { AppText } from "../ui/AppText";

/** The shared PR identity stays visible while choosing an account or a chat server. */
export function ForgeLinkPicker({
  children,
  close,
  target,
  title,
}: {
  readonly children: ReactNode;
  readonly close: () => void;
  readonly target: ForgeLinkTarget;
  readonly title: string;
}): React.JSX.Element {
  const change = useEvent((open: boolean): void => {
    if (!open) {
      close();
    }
  });
  return (
    <AppSheet contentProps={{ dismissLabel: "Close picker" }} isOpen={true} onOpenChange={change}>
      <AppSheetScrollView contentContainerStyle={styles.content}>
        <AppText accessibilityRole="header" style={styles.title}>
          {title}
        </AppText>
        <AppText style={styles.identity}>
          {target.repository} #{target.number}
        </AppText>
        {children}
      </AppSheetScrollView>
    </AppSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
  },
  identity: {
    ...typeScale.label,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  title: {
    ...typeScale.heading,
    color: colors.text,
    marginBottom: spacing.xs,
  },
});
