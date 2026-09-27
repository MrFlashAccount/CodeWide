import { useState } from "react";
import { KeyboardController } from "react-native-keyboard-controller";
import { useConstant } from "../../../react/useConstant";
import { useEvent } from "../../../react/useEvent";
import {
  useAppFullscreenOverlay,
  type AppFullscreenOverlayLifecycle,
} from "../../../ui/AppFullscreenOverlay";
import { createFullscreenScrollOwnership } from "../../../ui/fullscreen-scroll-ownership";

export function useOverlayScrollState() {
  const [fullscreenCovered, setFullscreenCovered] = useState(false);

  const fullscreenScrollOwnership = useConstant(() =>
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
    didClose: fullscreenScrollOwnership.didClose,
    willOpen: (id) => {
      fullscreenScrollOwnership.willOpen(id);
      cancelScheduledPaginationTrim();
      dismissComposerKeyboardForOverlay();
    },
  };

  const fullscreenOverlay = useAppFullscreenOverlay({
    lifecycle: fullscreenOverlayLifecycle,
    scope: composerScope,
  });

  const dismissComposerKeyboardForOverlay = useEvent(() => {
    // KeyboardController.dismiss is synchronous on Android. Treating its void
    // result as a Promise produced the global "undefined is not a function"
    // rejection whenever a menu or sheet opened.
    Promise.resolve(KeyboardController.dismiss({ animated: true, keepFocus: false })).catch(
      () => undefined,
    );
  });
  return { dismissComposerKeyboardForOverlay, fullscreenOverlay, fullscreenOverlayLifecycle };
}

import { Platform } from "react-native";
import { useAndroidBackHandler } from "../../../ui/use-android-back-handler";

export function useConversationAndroidBack(input: {
  readonly closeInlineQueueOverlay: () => void;
  readonly closeThreadSearch: () => void;
  readonly compact: boolean;
  readonly inlineQueueExpanded: boolean;
  readonly onBack: (() => void) | undefined;
  readonly threadSearchVisible: boolean;
}) {
  const handleAndroidBack = useEvent(() => {
    if (input.inlineQueueExpanded) {
      input.closeInlineQueueOverlay();
      return;
    }
    if (input.threadSearchVisible) {
      input.closeThreadSearch();
      return;
    }
    input.onBack?.();
  });

  const androidBackEnabled =
    Platform.OS === "android" &&
    (input.inlineQueueExpanded ||
      input.threadSearchVisible ||
      (input.compact && input.onBack !== undefined));
  useAndroidBackHandler(androidBackEnabled, handleAndroidBack);
}
