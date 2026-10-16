import { useIsFocused } from "expo-router";
import { useEffect } from "react";
import { BackHandler, Platform } from "react-native";

import { useEvent } from "../react/useEvent";
import { useFullscreenBack } from "./FullscreenBack";

/**
 * Owns one Android hardware-back subscription while the surface is active.
 * Inside a fullscreen modal it joins the modal's Back owner, whose native
 * dialog receives Back instead of the Activity's `BackHandler`.
 */
export function useAndroidBackHandler(enabled: boolean, onBack: () => void): void {
  const handleBack = useEvent(onBack);
  const isFocused = useIsFocused();
  const fullscreenBack = useFullscreenBack();
  useEffect(() => {
    if (Platform.OS !== "android" || !enabled) {
      return undefined;
    }
    if (fullscreenBack !== null) {
      return fullscreenBack.register(handleBack);
    }
    if (!isFocused) {
      return undefined;
    }
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      handleBack();
      return true;
    });
    return () => {
      subscription.remove();
    };
  }, [enabled, fullscreenBack, handleBack, isFocused]);
}
