import type { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";

import { colors } from "../../theme";

export function ConversationView({ children }: PropsWithChildren): React.JSX.Element {
  return <View style={styles.root}>{children}</View>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flex: 1, minHeight: 0 },
});
