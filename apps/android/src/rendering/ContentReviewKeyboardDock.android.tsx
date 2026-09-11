import { Column, Host, RNHostView } from "@expo/ui/jetpack-compose";
import { fillMaxSize, imePadding } from "@expo/ui/jetpack-compose/modifiers";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";

import { useOverlaySurface } from "../ui/OverlaySurfaceContext";

interface DockProps { children: ReactNode }

const DIALOG_DOCK_MODIFIERS = [fillMaxSize(), imePadding()];

/** Keyboard avoidance belongs to the window containing the focused input. */
export function ContentReviewKeyboardDock(props: DockProps) {
  const { surface } = useOverlaySurface();
  if (surface !== "fullscreen-modal") {
    return (
      <View pointerEvents="box-none" style={styles.layer}>
        <KeyboardStickyView offset={{ closed: 0, opened: 0 }} style={styles.sticky}>
          {props.children}
        </KeyboardStickyView>
      </View>
    );
  }
  // Keyboard Controller observes the Activity and ReactModalHostView, not Expo's
  // Compose Dialog. Read IME insets in that dialog instead. Only this overlay's
  // available height changes; the reviewed image and pin coordinates stay fixed.
  return (
    <Host colorScheme="dark" pointerEvents="box-none" ignoreSafeAreaKeyboardInsets style={styles.layer}>
      <Column modifiers={DIALOG_DOCK_MODIFIERS}>
        <RNHostView matchContents={false}>
          <View pointerEvents="box-none" style={styles.content}>
            {props.children}
          </View>
        </RNHostView>
      </Column>
    </Host>
  );
}

const styles = StyleSheet.create({
  layer: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 100, justifyContent: "flex-end" },
  sticky: { width: "100%", flexShrink: 0 },
  content: { flex: 1, minHeight: 0, justifyContent: "flex-end" },
});
