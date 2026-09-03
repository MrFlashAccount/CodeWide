import { StyleSheet, View } from "react-native";

import type { TerminalController } from "../../../application/terminalController";
import type { TerminalSession } from "../../../domain/terminalSession";
import { colors } from "../../../theme";
import { ProductText as Text } from "../../../presentation/text/ProductText";

interface TerminalRendererViewProps {
  controller: TerminalController;
  session: TerminalSession;
}

export function TerminalRendererView(_props: TerminalRendererViewProps): React.JSX.Element {
  return (
    <View style={styles.root}>
      <Text tone="muted">Terminal is available on Android only.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: "center",
  },
});
