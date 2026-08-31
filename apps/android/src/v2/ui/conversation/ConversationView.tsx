import type { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";

export function ConversationView({ children }: PropsWithChildren): React.JSX.Element {
  return <View style={styles.root}>{children}</View>;
}

const styles = StyleSheet.create({ root: { flex: 1 } });
