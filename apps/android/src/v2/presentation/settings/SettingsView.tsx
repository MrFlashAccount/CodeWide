import type { PropsWithChildren } from "react";
import { ScrollView, StyleSheet } from "react-native";

import { spacing } from "../../theme";

export function SettingsView(props: PropsWithChildren): React.JSX.Element {
  const { children } = props;
  return <ScrollView contentContainerStyle={styles.root}>{children}</ScrollView>;
}

const styles = StyleSheet.create({
  root: { gap: spacing.md, padding: spacing.md },
});
