import { Column, Host, RNHostView } from "@expo/ui/jetpack-compose";
import { fillMaxSize, imePadding } from "@expo/ui/jetpack-compose/modifiers";
import { StyleSheet, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

import type { KeyboardDockProps } from "./KeyboardDock.types";
import { useOverlaySurface } from "./OverlaySurfaceContext";

const DIALOG_DOCK_MODIFIERS = [fillMaxSize(), imePadding()];

/**
 * Android keyboard dock. Keyboard avoidance belongs to the window that holds
 * the focused input: Keyboard Controller observes the Activity and React Native
 * modals, not Expo's Compose dialog behind `AppFullscreenModal`, so inside one
 * the layer reads the dialog's IME insets through Compose instead. Both paths
 * resize the layer, so a filling child keeps the same meaning.
 */
export function KeyboardDock(props: KeyboardDockProps): React.JSX.Element {
  const { surface } = useOverlaySurface();
  if (surface !== "fullscreen-modal") {
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
  return (
    <Host
      colorScheme="dark"
      ignoreSafeAreaKeyboardInsets
      pointerEvents="box-none"
      style={styles.layer}
    >
      <Column modifiers={DIALOG_DOCK_MODIFIERS}>
        <DialogDockContent>{props.children}</DialogDockContent>
      </Column>
    </Host>
  );
}

/** React Native content inside the Compose column; its children dock at the bottom. */
function DialogDockContent(props: KeyboardDockProps): React.JSX.Element {
  return (
    <RNHostView matchContents={false}>
      <View pointerEvents="box-none" style={styles.content}>
        {props.children}
      </View>
    </RNHostView>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    justifyContent: "flex-end",
    minHeight: 0,
  },
  layer: {
    ...StyleSheet.absoluteFill,
    justifyContent: "flex-end",
  },
});
