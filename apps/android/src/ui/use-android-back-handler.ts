import { useIsFocused } from "expo-router";
import { useEffect } from "react";
import { BackHandler, Platform } from "react-native";

import { useEvent } from "../react/useEvent";

/** Owns one Android hardware-back subscription while the surface is active. */
export function useAndroidBackHandler(enabled: boolean, onBack: () => void): void {
  const handleBack = useEvent(onBack);
  const isFocused = useIsFocused();
  useEffect(() => {
    if (Platform.OS !== "android" || !enabled || !isFocused) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      handleBack();
      return true;
    });
    return () => subscription.remove();
  }, [enabled, handleBack, isFocused]);
}
