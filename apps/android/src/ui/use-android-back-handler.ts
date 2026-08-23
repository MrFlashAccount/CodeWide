import { useEffect } from "react";
import { BackHandler, Platform } from "react-native";

import { useEvent } from "../react/useEvent";

/** Owns one Android hardware-back subscription while the surface is active. */
export function useAndroidBackHandler(enabled: boolean, onBack: () => void): void {
  const handleBack = useEvent(onBack);
  useEffect(() => {
    if (Platform.OS !== "android" || !enabled) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      handleBack();
      return true;
    });
    return () => subscription.remove();
  }, [enabled, handleBack]);
}
