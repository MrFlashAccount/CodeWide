import { useEffect } from "react";
import { Keyboard, Platform } from "react-native";
import { useKeyboardContext } from "react-native-keyboard-controller";

import { useEvent } from "../react/useEvent";

/** Reconciles controller geometry when Android hides the IME outside its animation callback. */
export function AndroidKeyboardGeometrySync(): null {
  const { reanimated } = useKeyboardContext();
  const handleKeyboardDidHide = useEvent(() => {
    reanimated.height.set(0);
    reanimated.progress.set(0);
  });

  useEffect(() => {
    if (Platform.OS !== "android") {
      return undefined;
    }

    const subscription = Keyboard.addListener("keyboardDidHide", handleKeyboardDidHide);
    return () => {
      subscription.remove();
    };
  }, [handleKeyboardDidHide]);

  return null;
}
