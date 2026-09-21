import { act, render } from "@testing-library/react-native";
import { Keyboard, Platform, type KeyboardEvent } from "react-native";
import { useKeyboardContext } from "react-native-keyboard-controller";

import { AndroidKeyboardGeometrySync } from "../src/ui/AndroidKeyboardGeometrySync";

const hiddenKeyboardEvent: KeyboardEvent = {
  duration: 0,
  easing: "keyboard",
  endCoordinates: { height: 0, screenX: 0, screenY: 800, width: 400 },
};

it("resets shared keyboard geometry after Android reports that the IME is hidden", () => {
  const platform = jest.replaceProperty(Platform, "OS", "android");
  let handleKeyboardDidHide: ((event: KeyboardEvent) => unknown) | undefined;
  const removeListener = jest.fn();
  const addListener = jest.spyOn(Keyboard, "addListener").mockImplementation((event, listener) => {
    if (event === "keyboardDidHide") {
      handleKeyboardDidHide = listener;
    }
    return { remove: removeListener };
  });
  let context: ReturnType<typeof useKeyboardContext> | null = null;
  function ContextProbe(): null {
    context = useKeyboardContext();
    return null;
  }
  const view = render(
    <>
      <AndroidKeyboardGeometrySync />
      <ContextProbe />
    </>,
  );
  if (context === null) {
    throw new Error("Keyboard context did not mount");
  }
  context.reanimated.height.set(-320);
  context.reanimated.progress.set(1);

  act(() => {
    handleKeyboardDidHide?.(hiddenKeyboardEvent);
  });

  expect(context.reanimated.height.value).toBe(0);
  expect(context.reanimated.progress.value).toBe(0);
  view.unmount();
  expect(removeListener).toHaveBeenCalledTimes(1);
  addListener.mockRestore();
  platform.restore();
});
