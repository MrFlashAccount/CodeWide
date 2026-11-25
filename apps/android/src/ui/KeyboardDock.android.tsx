import { Host, Spacer } from "@expo/ui/jetpack-compose";
import { defaultMinSize, imePadding } from "@expo/ui/jetpack-compose/modifiers";
import { StyleSheet, View } from "react-native";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Reanimated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { KeyboardDockProps } from "./KeyboardDock.types";
import { useOverlaySurface } from "./OverlaySurfaceContext";

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
  const lift = useActivityKeyboardLift();
  return (
    <Reanimated.View pointerEvents="box-none" style={[styles.layer, lift]} testID="keyboard-dock">
      {props.children}
    </Reanimated.View>
  );
}

function useActivityKeyboardLift() {
  const { height } = useReanimatedKeyboardAnimation();
  const { bottom } = useSafeAreaInsets();
  return useAnimatedStyle(() => ({
    // The animation reports the open keyboard as a negative height.
    paddingBottom: Math.max(0, -height.get() - bottom),
  }));
}

function ActivityKeyboardSpacer(): React.JSX.Element {
  const lift = useActivityKeyboardLift();
  return <Reanimated.View pointerEvents="none" style={lift} />;
}

/** Shrinks the preceding flex content to the space above the keyboard in its own window. */
export function KeyboardDockSpacer(): React.JSX.Element {
  const { surface } = useOverlaySurface();
  return surface === "fullscreen-modal" ? <DialogKeyboardSpacer /> : <ActivityKeyboardSpacer />;
}

/**
 * The dialog's safe area already excludes the navigation bar. Reserve only the
 * part of the IME above that edge. Compose measures the actual dialog IME on
 * the UI thread; the composer stays in the same RN tree as the review toolbar.
 */
function DialogKeyboardDock(props: KeyboardDockProps): React.JSX.Element {
  return (
    <View pointerEvents="box-none" style={styles.layer} testID="keyboard-dock">
      {props.children}
      <DialogKeyboardSpacer />
    </View>
  );
}

function DialogKeyboardSpacer(): React.JSX.Element {
  const { bottom } = useSafeAreaInsets();
  return (
    <Host
      ignoreSafeAreaKeyboardInsets
      matchContents={{ vertical: true }}
      pointerEvents="none"
      style={{ marginBottom: -bottom }}
    >
      <Spacer modifiers={[defaultMinSize({ minHeight: bottom }), imePadding()]} />
    </Host>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFill,
    justifyContent: "flex-end",
  },
});
