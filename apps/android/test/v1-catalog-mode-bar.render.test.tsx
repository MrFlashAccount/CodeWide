import { act, fireEvent, render } from "@testing-library/react-native";
import * as Reanimated from "react-native-reanimated";
import { AppState, StyleSheet, View } from "react-native";
import { Gesture, State } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";

import type { ReactTestInstance } from "react-test-renderer";

import { CatalogModeBar, type CatalogMode } from "../src/features/pullRequests/CatalogModeBar";
import { colors } from "../src/theme";
import { startPillMotionOnUI } from "../vendor/reacticx/src/components/organisms/masked-tab-bar/motion";

jest.mock("react-native-reanimated", () => {
  const base = jest.requireActual("./mocks/Reanimated");
  const React = jest.requireActual("react");
  return {
    __esModule: true,
    ...base,
    // Native animated styles react to shared-value writes without a React render.
    // Evaluate style properties on read so assertions see the settled UI projection.
    useAnimatedStyle: (factory: () => Record<string, unknown>) => {
      const style = factory();
      for (const key of Object.keys(style)) {
        Object.defineProperty(style, key, { get: () => factory()[key], enumerable: true });
      }
      return style;
    },
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
  const gesture = getByGestureTestId("catalog-tab-pan");

  act(() => {
    fireGestureHandler<ReturnType<typeof Gesture.Tap>>(getByGestureTestId("catalog-tab-tap"), [
      { state: State.END, x: 225 },
    ]);
  });
  expect(onSelect.mock.calls).toEqual([["pullRequests"]]);
  onSelect.mockClear();

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

function nativeView(node: ReactTestInstance): View {
  const instance = node.instance;
  if (!(instance instanceof View)) throw new Error("Expected a native View mock");
  return instance;
}

/** Queue native replies so tests can deliver them after a resize or a later resume. */
function captureMeasurements(view: ReturnType<typeof render>) {
  const nodes = view
    .UNSAFE_getAllByType(View)
    .filter((node) => typeof node.props.onLayout === "function");
  const [list, ...triggers] = nodes;
  if (!list) throw new Error("Expected a tab list");
  const listReplies: Array<Parameters<View["measure"]>[0]> = [];
  nativeView(list).measure = jest.fn((reply) => {
    listReplies.push(reply);
  });
  const tabs = triggers.map((node) => {
    const replies: Array<Parameters<View["measureLayout"]>[1]> = [];
    nativeView(node).measureLayout = jest.fn((row, reply) => {
      // Coordinates must be relative to the same base row as onLayout.
      let parent = node.parent;
      while (parent !== null && parent.type !== View) parent = parent.parent;
      expect(row).toBe(parent?.instance);
      expect(parent?.props.collapsable).toBe(false);
      replies.push(reply);
    });
    return {
      node,
      replies,
      pullRequests: node.findAllByProps({ children: "Pull requests" }).length > 0,
    };
  });
  return {
    list,
    deliver: (request: number, width: number) => {
      act(() => {
        listReplies[request]?.(0, 0, width, 48, 0, 0);
        for (const tab of tabs) {
          tab.replies[request]?.(tab.pullRequests ? width / 2 : 0, 0, width / 2, 48);
        }
      });
    },
    relayout: (width: number) => {
      fireEvent(list, "layout", { nativeEvent: { layout: { width } } });
      for (const tab of tabs) {
        fireEvent(tab.node, "layout", {
          nativeEvent: { layout: { x: tab.pullRequests ? width / 2 : 0, width: width / 2 } },
        });
      }
    },
  };
}

function expectPill(view: ReturnType<typeof render>, x: number, width: number): void {
  const clip = view
    .UNSAFE_getAllByType(View)
    .find(
      (node) =>
        node.props.pointerEvents === "none" &&
        StyleSheet.flatten(node.props.style)?.overflow === "hidden",
    );
  if (!clip) throw new Error("Expected the visible selection mask");
  expect(StyleSheet.flatten(clip.props.style)).toMatchObject({
    width,
    transform: [{ translateX: x }],
  });
  const content = clip.findAllByType(View).find((node) => {
    const style = StyleSheet.flatten(node.props.style);
    return style?.flexDirection === "row" && typeof style.width === "number";
  });
  if (!content) throw new Error("Expected the full-width content inside the mask");
  expect(StyleSheet.flatten(content.props.style)).toMatchObject({ width: width * 2 });
}

function foregroundEvents() {
  let notify: ((state: string) => void) | undefined;
  const remove = jest.fn();
  const subscribe = jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((_type, listener) => {
      notify = listener;
      return { remove };
    });
  return {
    remove,
    subscribe,
    resume: () =>
      act(() => {
        notify?.("background");
        notify?.("active");
      }),
  };
}

it.each<CatalogMode>(["threads", "pullRequests"])(
  "restores %s geometry and hit targets after resume without layout events or remounting",
  (mode) => {
    const events = foregroundEvents();
    const onSelect = jest.fn();
    const view = render(<CatalogModeBar mode={mode} onSelect={onSelect} />);
    layOutMaskedTabs(view);
    const measurements = captureMeasurements(view);
    const originalList = nativeView(measurements.list);
    const spring = jest.spyOn(Reanimated, "withSpring");
    spring.mockClear();

    events.resume();
    measurements.deliver(0, 600);
    expectPill(view, mode === "threads" ? 0 : 300, 300);
    expect(spring).not.toHaveBeenCalled();
    expect(nativeView(captureMeasurements(view).list)).toBe(originalList);

    // Both points were outside the intended tab in the old 300-wide layout.
    const x = mode === "threads" ? 450 : 225;
    act(() => {
      fireGestureHandler<ReturnType<typeof Gesture.Pan>>(getByGestureTestId("catalog-tab-pan"), [
        { state: State.BEGAN, translationX: 0, translationY: 0, x },
        { state: State.ACTIVE, translationX: 0, translationY: 0, x },
        { state: State.END, translationX: 0, translationY: 0, x },
      ]);
    });
    expect(onSelect).toHaveBeenCalledWith(mode === "threads" ? "pullRequests" : "threads");
    view.unmount();
    expect(events.remove).toHaveBeenCalled();
    spring.mockRestore();
    events.subscribe.mockRestore();
  },
);

it("keeps newer layout and foreground measurements when older native replies arrive late", () => {
  const events = foregroundEvents();
  const view = render(<CatalogModeBar mode="pullRequests" onSelect={jest.fn()} />);
  layOutMaskedTabs(view);
  const measurements = captureMeasurements(view);

  events.resume();
  measurements.relayout(500);
  measurements.deliver(0, 300);
  expectPill(view, 250, 250);

  events.resume();
  events.resume();
  measurements.deliver(2, 600);
  measurements.deliver(1, 400);
  expectPill(view, 300, 300);

  // A temporarily unmeasurable/hidden native view must not erase valid geometry.
  events.resume();
  measurements.deliver(3, 0);
  expectPill(view, 300, 300);
  view.unmount();
  measurements.deliver(3, 200);
  events.subscribe.mockRestore();
});

it("moves the pill without a spring when only the layout of the selected tab changes", () => {
  const subscribe = jest.spyOn(AppState, "addEventListener").mockReturnValue({ remove: jest.fn() });
  const view = render(<CatalogModeBar mode="threads" onSelect={jest.fn()} />);
  layOutMaskedTabs(view);
  const spring = jest.spyOn(Reanimated, "withSpring");
  spring.mockClear();
  // The window widens: the same selected tab gets a new box.
  const layoutNodes = view
    .UNSAFE_getAllByType(View)
    .filter((node) => typeof node.props.onLayout === "function");
  const [list, ...triggers] = layoutNodes;
  if (list === undefined) {
    throw new Error("Expected the masked tab list");
  }
  fireEvent(list, "layout", { nativeEvent: { layout: { width: 400 } } });
  for (const trigger of triggers) {
    const pullRequests = trigger.findAllByProps({ children: "Pull requests" }).length > 0;
    fireEvent(trigger, "layout", {
      nativeEvent: { layout: { width: 200, x: pullRequests ? 200 : 0 } },
    });
  }
  expect(spring).not.toHaveBeenCalled();

  view.rerender(<CatalogModeBar mode="pullRequests" onSelect={jest.fn()} />);
  expect(spring).toHaveBeenCalled();
  spring.mockRestore();
  view.unmount();
  subscribe.mockRestore();
});
