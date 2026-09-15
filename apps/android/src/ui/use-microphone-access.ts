import { useRef, useSyncExternalStore } from "react";
import { Linking } from "react-native";

import {
  getMicrophonePermission,
  requestMicrophonePermission,
  subscribeMicrophonePermission,
} from "../native/native-transport";
import { useEvent } from "../react/useEvent";
import { useAppDialog } from "./AppDialog";

/** Permission actions never start capture; a subsequent microphone tap does. */
export function useMicrophoneAccess() {
  const permission = useSyncExternalStore(
    subscribeMicrophonePermission,
    getMicrophonePermission,
    getMicrophonePermission,
  );
  const dialog = useAppDialog();
  const requesting = useRef(false);
  const openSettings = useEvent(async () => {
    try {
      await Linking.openSettings();
    } catch (error) {
      dialog.alert(
        "Microphone access",
        error instanceof Error ? error.message : "Could not open Android settings.",
      );
    }
  });
  const request = useEvent(async () => {
    if (requesting.current) return;
    requesting.current = true;
    let errorMessage: string | null = null;
    try {
      if (getMicrophonePermission() === "blocked") await openSettings();
      else {
        const result = await requestMicrophonePermission();
        if (result === "blocked")
          dialog.alert(
            "Microphone access",
            "Allow microphone access in Android settings to use voice input.",
            [
              { text: "Not now", style: "cancel" },
              {
                text: "Open settings",
                onPress: () => {
                  void openSettings();
                },
              },
            ],
          );
      }
    } catch (error) {
      errorMessage =
        error instanceof Error ? error.message : "Could not request microphone access.";
    }
    requesting.current = false;
    if (errorMessage !== null) dialog.alert("Microphone access", errorMessage);
  });
  const allowCapture = useEvent(() => {
    if (getMicrophonePermission() === "granted") return true;
    dialog.alert(
      "Microphone access",
      "Allow microphone access to dictate text. Recording starts only when you tap the microphone.",
      [
        { text: "Not now", style: "cancel" },
        {
          text: getMicrophonePermission() === "blocked" ? "Open settings" : "Allow access",
          onPress: () => {
            void request();
          },
        },
      ],
    );
    return false;
  });
  return { granted: permission === "granted", allowCapture };
}
