import type { PropsWithChildren } from "react";
import { ScrollView, StyleSheet } from "react-native";

import { spacing } from "../../theme";

export function SettingsView({ children }: PropsWithChildren): React.JSX.Element {
  return <ScrollView contentContainerStyle={styles.root}>{children}</ScrollView>;
}

const styles = StyleSheet.create({
  root: { gap: spacing.md, padding: spacing.md },
});
