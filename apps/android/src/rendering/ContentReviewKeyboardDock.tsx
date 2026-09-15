import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";

interface DockProps {
  children: ReactNode;
}

export function ContentReviewKeyboardDock(props: DockProps) {
  return (
    <View pointerEvents="box-none" style={styles.layer}>
      <KeyboardStickyView offset={{ closed: 0, opened: 0 }} style={styles.sticky}>
        {props.children}
      </KeyboardStickyView>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 100,
    justifyContent: "flex-end",
  },
  sticky: {
    width: "100%",
    flexShrink: 0,
  },
});
