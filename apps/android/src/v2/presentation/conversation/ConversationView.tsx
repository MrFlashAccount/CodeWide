import type { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";

import { colors } from "../../theme";

export function ConversationView(props: PropsWithChildren): React.JSX.Element {
  const { children } = props;
  return <View style={styles.root}>{children}</View>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flex: 1, minHeight: 0 },
});
