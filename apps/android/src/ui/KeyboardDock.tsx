import { StyleSheet } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

import type { KeyboardDockProps } from "./KeyboardDock.types";

/**
 * A layer over its positioned parent whose children dock at the bottom and stay
 * above the keyboard. The layer passes touches outside its children through, so
 * the content beneath stays interactive. It resizes rather than translates, so a
 * child can fill the room the keyboard leaves. Keyboard Controller measures the
 * layer in the window, so a pane that does not reach the screen's bottom edge
 * avoids only the part of the keyboard that covers it.
 */
export function KeyboardDock(props: KeyboardDockProps): React.JSX.Element {
  return (
    <KeyboardAvoidingView
      automaticOffset
      behavior="padding"
      pointerEvents="box-none"
      style={styles.layer}
    >
      {props.children}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFill,
    justifyContent: "flex-end",
  },
});
