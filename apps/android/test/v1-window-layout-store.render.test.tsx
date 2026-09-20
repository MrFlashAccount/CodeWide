import { Dimensions } from "react-native";

import { windowLayoutStore } from "../src/native/window-layout-store";

describe("V1 window layout measurement invalidation", () => {
  it("publishes only when density or font scale changes", () => {
    const initialWindow = Dimensions.get("window");
    const initialScreen = Dimensions.get("screen");
    const listener = jest.fn();
    const unsubscribe = windowLayoutStore.subscribeMeasurementInvalidation(listener);

    try {
      Dimensions.set({
        screen: initialScreen,
        window: { ...initialWindow, width: initialWindow.width + 1 },
      });
      expect(listener).not.toHaveBeenCalled();

      Dimensions.set({
        screen: initialScreen,
        window: { ...initialWindow, fontScale: initialWindow.fontScale + 0.1 },
      });
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      Dimensions.set({ screen: initialScreen, window: initialWindow });
      unsubscribe();
    }
  });
});
