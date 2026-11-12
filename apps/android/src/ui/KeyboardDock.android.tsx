import { Column, Host, RNHostView } from "@expo/ui/jetpack-compose";
import { fillMaxSize, imePadding } from "@expo/ui/jetpack-compose/modifiers";
import { StyleSheet, View } from "react-native";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Reanimated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
  return surface === "fullscreen-modal" ? (
    <DialogKeyboardDock>{props.children}</DialogKeyboardDock>
  ) : (
    <ActivityKeyboardDock>{props.children}</ActivityKeyboardDock>
  );
}

/**
 * The Activity's dock, which keeps its children above the keyboard from the
 * keyboard's height every frame, exactly as the conversation composer's sticky
 * view does: a dock ends at the pane's bottom, one navigation-bar inset above
 * the window's bottom, so the keyboard covers that much less of it. It measures
 * nothing: a moving or rearranged pane cannot leave it with a stale position.
 */
function ActivityKeyboardDock(props: KeyboardDockProps): React.JSX.Element {
  const { height } = useReanimatedKeyboardAnimation();
  const { bottom } = useSafeAreaInsets();
  const lift = useAnimatedStyle(() => ({
    // The animation reports the open keyboard as a negative height.
    paddingBottom: Math.max(0, -height.get() - bottom),
  }));
  return (
    <Reanimated.View pointerEvents="box-none" style={[styles.layer, lift]} testID="keyboard-dock">
      {props.children}
    </Reanimated.View>
  );
}

/** The Compose dialog's dock, from the dialog's own IME insets. */
function DialogKeyboardDock(props: KeyboardDockProps): React.JSX.Element {
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
