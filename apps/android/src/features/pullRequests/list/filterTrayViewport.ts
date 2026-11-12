const FILTER_TRAY_HEIGHT_RATIO = 0.82;
const FILTER_TRAY_MAX_HEIGHT = 720;
const FILTER_TRAY_TOP_GAP = 12;

export type FilterTrayViewportGeometry = {
  readonly bottomInsetCompensation: number;
  readonly height: number;
};

/** Bounds the filter tray to the viewport left visible above the IME. */
export function filterTrayViewportGeometry({
  bottomInset,
  keyboardHeight,
  topInset,
  windowHeight,
}: {
  readonly bottomInset: number;
  readonly keyboardHeight: number;
  readonly topInset: number;
  readonly windowHeight: number;
}): FilterTrayViewportGeometry {
  const boundedWindowHeight = Math.max(0, windowHeight);
  const boundedKeyboardHeight = Math.min(Math.max(0, keyboardHeight), boundedWindowHeight);
  const keyboardOpen = boundedKeyboardHeight > 0;
  const visualViewportHeight = boundedWindowHeight - boundedKeyboardHeight;
  const visualBottomInset = keyboardOpen ? 0 : Math.max(0, bottomInset);
  const availableHeight = Math.max(
    0,
    visualViewportHeight - Math.max(0, topInset) - visualBottomInset - FILTER_TRAY_TOP_GAP,
  );
  const preferredHeight = Math.min(
    Math.round(boundedWindowHeight * FILTER_TRAY_HEIGHT_RATIO),
    FILTER_TRAY_MAX_HEIGHT,
  );

  return {
    bottomInsetCompensation: keyboardOpen ? Math.max(0, bottomInset) : 0,
    height: Math.min(preferredHeight, availableHeight),
  };
}
