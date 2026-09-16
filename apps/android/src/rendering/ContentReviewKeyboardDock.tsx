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
    bottom: 0,
    justifyContent: "flex-end",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 100,
  },
  sticky: {
    flexShrink: 0,
    width: "100%",
  },
});
