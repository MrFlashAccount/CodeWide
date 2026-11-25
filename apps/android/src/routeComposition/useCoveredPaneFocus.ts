import { useLayoutEffect, useRef, type RefObject } from "react";
import { Keyboard, TextInput, type HostInstance, type View } from "react-native";

// The public RN declaration omits null; the native focus owner returns null without a focused input.
function focusedInput(): HostInstance | null {
  return TextInput.State.currentlyFocusedInput();
}

/** Dismisses the keyboard only when its own pane is committed as hidden. */
export function useCoveredPaneFocus(hidden: boolean): RefObject<View | null> {
  const pane = useRef<View>(null);
  useLayoutEffect(() => {
    if (hidden) {
      const input = focusedInput();
      if (input !== null && pane.current?.contains(input) === true) {
        Keyboard.dismiss();
      }
    }
  }, [hidden]);
  return pane;
}
