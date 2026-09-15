import { useState } from "react";
import { KeyboardController } from "react-native-keyboard-controller";
import { useEvent } from "../../../react/useEvent";
import {
  useAppFullscreenOverlay,
  type AppFullscreenOverlayLifecycle,
} from "../../../ui/AppFullscreenOverlay";
import { createFullscreenScrollOwnership } from "../../../ui/fullscreen-scroll-ownership";

export function useOverlayScrollState() {
  const [fullscreenCovered, setFullscreenCovered] = useState(false);

  const [fullscreenScrollOwnership] = useState(() =>
    createFullscreenScrollOwnership((covered) => {
      // Covering the timeline suspends pagination and tail following, not keyboard
      // geometry: dismissing the IME must still remove its inset behind the overlay.
      setFullscreenCovered(covered);
    }),
  );
  return { fullscreenCovered, fullscreenScrollOwnership };
}

export function useOverlayScrollOwnership(
  composerScope: string,
  fullscreenScrollOwnership: ReturnType<typeof createFullscreenScrollOwnership>,
  cancelScheduledPaginationTrim: () => void,
) {
  const fullscreenOverlayLifecycle: AppFullscreenOverlayLifecycle = {
    willOpen: (id) => {
      fullscreenScrollOwnership.willOpen(id);
      cancelScheduledPaginationTrim();
      dismissComposerKeyboardForOverlay();
    },
    didClose: fullscreenScrollOwnership.didClose,
  };

  const fullscreenOverlay = useAppFullscreenOverlay({
    scope: composerScope,
    lifecycle: fullscreenOverlayLifecycle,
  });

  const dismissComposerKeyboardForOverlay = useEvent(() => {
    // KeyboardController.dismiss is synchronous on Android. Treating its void
    // result as a Promise produced the global "undefined is not a function"
    // rejection whenever a menu or sheet opened.
    KeyboardController.dismiss({ animated: true, keepFocus: false });
  });
  return { fullscreenOverlay, fullscreenOverlayLifecycle, dismissComposerKeyboardForOverlay };
}

import { Platform } from "react-native";
import { useAndroidBackHandler } from "../../../ui/use-android-back-handler";

export function useConversationAndroidBack(
  inlineQueueExpanded: boolean,
  closeInlineQueueOverlay: () => void,
  compact: boolean,
  onBack: (() => void) | undefined,
) {
  const handleAndroidBack = useEvent(() => {
    if (inlineQueueExpanded) {
      closeInlineQueueOverlay();
      return;
    }
    onBack?.();
  });

  const androidBackEnabled =
    Platform.OS === "android" && (inlineQueueExpanded || (compact && onBack !== undefined));
  useAndroidBackHandler(androidBackEnabled, handleAndroidBack);
}
