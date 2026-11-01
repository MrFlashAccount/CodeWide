import { act, fireEvent, render } from "@testing-library/react-native";
import * as Reanimated from "react-native-reanimated";
import { View } from "react-native";
import { Gesture, GestureDetector, State } from "react-native-gesture-handler";
import { fireGestureHandler } from "react-native-gesture-handler/jest-utils";

import { CatalogModeBar } from "../src/features/pullRequests/CatalogModeBar";
import { colors } from "../src/theme";
import { startPillMotionOnUI } from "../vendor/reacticx/src/components/organisms/masked-tab-bar/motion";

jest.mock("react-native-reanimated", () => {
  const base = jest.requireActual("./mocks/Reanimated");
  const React = jest.requireActual("react");
  return {
    __esModule: true,
    ...base,
    // The native hook retains one shared-value object. This local mock preserves that identity so
    // GestureDetector's registered handler observes layout updates after React rerenders.
    useSharedValue: (initial: unknown) => {
      const currentValue = React.useRef(initial);
      return React.useRef({
        get value() {
          return currentValue.current;
        },
        set value(next: unknown) {
          currentValue.current = next;
        },
        get: () => currentValue.current,
        set: (next: unknown) => {
          currentValue.current = next;
        },
      }).current;
    },
  };
});

function layOutMaskedTabs(view: ReturnType<typeof render>): void {
  const layoutNodes = view
    .UNSAFE_getAllByType(View)
    .filter((node) => typeof node.props.onLayout === "function");
  const list = layoutNodes[0];
  const triggers = layoutNodes.slice(1);
  if (list === undefined || triggers.length < 2) {
    throw new Error("Expected the masked tab list and two base-layer triggers");
  }
  fireEvent(list, "layout", { nativeEvent: { layout: { width: 300 } } });
  for (const trigger of triggers) {
    const pullRequests = trigger.findAllByProps({ children: "Pull requests" }).length > 0;
    fireEvent(trigger, "layout", {
      nativeEvent: { layout: { width: 150, x: pullRequests ? 150 : 0 } },
    });
  }
}

it("exposes the two masked destinations as accessible tabs", () => {
  const onSelect = jest.fn();
  const view = render(<CatalogModeBar mode="threads" onSelect={onSelect} />);

  expect(view.getByTestId("catalog-mode-bar")).not.toHaveStyle({
    backgroundColor: colors.threadListSurface,
  });
  expect(view.getByRole("tab", { name: "Threads" }).props.accessibilityState).toEqual({
    selected: true,
  });
  expect(view.getByRole("tab", { name: "Pull requests" }).props.accessibilityState).toEqual({
    selected: false,
  });

  fireEvent(view.getByRole("tab", { name: "Pull requests" }), "accessibilityAction", {
    nativeEvent: { actionName: "activate" },
  });
  expect(onSelect).toHaveBeenCalledWith("pullRequests");

  fireEvent(view.getByRole("tab", { name: "Threads" }), "accessibilityTap");
  expect(onSelect).toHaveBeenNthCalledWith(2, "threads");
});

it("starts pointer selection motion on the UI runtime", () => {
  const spring = jest.spyOn(Reanimated, "withSpring");
  const pillX = { value: 0 };
  const pillWidth = { value: 150 };
  spring.mockClear();

  startPillMotionOnUI({ value: "pullRequests", width: 150, x: 150 }, pillX, pillWidth);

  expect(pillX.value).toBe(150);
  expect(pillWidth.value).toBe(150);
  expect(spring).toHaveBeenCalledTimes(2);
  spring.mockRestore();
});

it("commits only successful tap and drag gestures", () => {
  const onSelect = jest.fn();
  const view = render(<CatalogModeBar mode="threads" onSelect={onSelect} />);
  layOutMaskedTabs(view);
  const gesture = view.UNSAFE_getByType(GestureDetector).props.gesture;

  act(() => {
    fireGestureHandler<ReturnType<typeof Gesture.Pan>>(gesture, [
      { state: State.BEGAN, translationX: 0, translationY: 0, x: 75 },
      { state: State.ACTIVE, translationX: 0, translationY: 0, x: 75 },
      { state: State.END, translationX: 0, translationY: 0, x: 75 },
    ]);
  });
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onSelect).toHaveBeenLastCalledWith("threads");

  onSelect.mockClear();
  act(() => {
    fireGestureHandler<ReturnType<typeof Gesture.Pan>>(gesture, [
      { state: State.BEGAN, translationX: 0, translationY: 0, x: 75 },
      { state: State.ACTIVE, translationX: 0, translationY: 0, x: 75 },
      { state: State.CANCELLED, translationX: 0, translationY: 0, x: 75 },
    ]);
  });
  expect(onSelect).not.toHaveBeenCalled();

  act(() => {
    fireGestureHandler<ReturnType<typeof Gesture.Pan>>(gesture, [
      { state: State.BEGAN, translationX: 0, translationY: 0, x: 75 },
      { state: State.FAILED, translationX: 0, translationY: 0, x: 75 },
    ]);
  });
  expect(onSelect).not.toHaveBeenCalled();

  act(() => {
    fireGestureHandler<ReturnType<typeof Gesture.Pan>>(gesture, [
      { state: State.BEGAN, translationX: 0, translationY: 0, x: 75 },
      { state: State.ACTIVE, translationX: 0, translationY: 0, x: 75 },
      { state: State.ACTIVE, translationX: 0, translationY: 20, x: 75 },
      { state: State.END, translationX: 0, translationY: 20, x: 75 },
    ]);
  });
  expect(onSelect).not.toHaveBeenCalled();

  act(() => {
    fireGestureHandler<ReturnType<typeof Gesture.Pan>>(gesture, [
      { state: State.BEGAN, translationX: 0, translationY: 0, x: 75 },
      { state: State.ACTIVE, translationX: 0, translationY: 0, x: 75 },
      { state: State.ACTIVE, translationX: 150, translationY: 0, x: 225 },
      { state: State.END, translationX: 150, translationY: 0, x: 225 },
    ]);
  });
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onSelect).toHaveBeenLastCalledWith("pullRequests");
});
