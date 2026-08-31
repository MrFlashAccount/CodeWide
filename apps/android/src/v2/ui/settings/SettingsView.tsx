import type { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";

export function SettingsView({ children }: PropsWithChildren): React.JSX.Element {
  return <View style={styles.root}>{children}</View>;
}

const styles = StyleSheet.create({ root: { gap: 16, padding: 20 } });
