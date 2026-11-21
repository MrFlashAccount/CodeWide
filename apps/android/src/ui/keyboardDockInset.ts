import { useKeyboardState } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useOverlaySurface } from "./OverlaySurfaceContext";

/**
 * Bottom inset a `KeyboardDock` child pads itself with, so its surface reaches
 * the screen edge while its controls stay above the navigation bar. The open
 * keyboard covers that bar, and a fullscreen modal's own safe area already
 * keeps its content above it, so both use none.
 */
export function useKeyboardDockBottomInset(): number {
  const { surface } = useOverlaySurface();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  return surface === "fullscreen-modal" || keyboardVisible ? 0 : insets.bottom;
}
