import { useContext, type PropsWithChildren } from "react";
import { StyleSheet } from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";

import { colors } from "../../theme";

export function ConversationComposerDockView(props: PropsWithChildren): React.JSX.Element {
  const { children } = props;
  const insets = useContext(SafeAreaInsetsContext);
  return (
    <KeyboardStickyView
      enabled
      offset={{ closed: 0, opened: insets?.bottom ?? 0 }}
      style={styles.root}
    >
      {children}
    </KeyboardStickyView>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flexShrink: 0 },
});
