import { act, fireEvent, render } from "@testing-library/react-native";
import { useState, type ReactNode } from "react";
import { StyleSheet, Text } from "react-native";
import { Gesture, State } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";

import { CodeWideSlider } from "../src/ui/CodeWideSlider.native";
import { sliderProgressAt, sliderStopAt, sliderStopCenter } from "../src/ui/sliderGeometry";
import { controlSize, radii } from "../src/theme";
import { ModelThinkingMenu } from "../src/ui/TurnControlMenus";

// WHY: Node cannot mount Expo's Compose popup; the adapter stays at the native boundary.
jest.mock("@expo/ui/jetpack-compose", () => {
  const NativeView = require("react-native").View;
  const React = require("react");
  const Menu = (props: { children: ReactNode; expanded: boolean; onDismissRequest(): void }) =>
    React.createElement(NativeView, { ...props, testID: "compose-model-menu" }, props.children);
  Menu.Trigger = NativeView;
  Menu.Items = NativeView;
  return { Host: NativeView, RNHostView: NativeView, DropdownMenu: Menu };
});

// WHY: The modifier entrypoint imports native Expo internals unavailable in Jest.
jest.mock("@expo/ui/jetpack-compose/modifiers", () => ({
  width: (value: number) => ({ width: value }),
}));

const models = [
  {
    defaultEffort: "medium",
    efforts: ["low", "medium", "high", "max", "ultra"],
    id: "sol",
    label: "GPT-6 Sol",
    serviceTiers: [{ id: "priority", name: "Fast", description: "Faster responses" }],
    supportsPersonality: false,
  },
  {
    defaultEffort: "high",
    efforts: ["high", "max"],
    id: "astra",
    label: "GPT-6 Astra",
    serviceTiers: [],
    supportsPersonality: false,
  },
];

function mount(selectedServiceTier: string | null = null) {
  const onApplySettings = jest.fn();
  const onClose = jest.fn();
  const view = render(
    <ModelThinkingMenu
      accessibilityLabel="Model and thinking"
      error={null}
      loading={false}
      models={models}
      onApplySettings={onApplySettings}
      onClose={onClose}
      onFallbackPress={jest.fn()}
      onOpen={jest.fn()}
      selectedEffort="high"
      selectedModel="sol"
      selectedPersonality={null}
      selectedServiceTier={selectedServiceTier}
      triggerChildren={<Text>GPT-6 Sol · high</Text>}
      triggerStyle={{}}
    />,
  );
  fireEvent.press(view.getByRole("button", { name: "Model and thinking" }));
  return { view, onApplySettings, onClose };
}

it("stages model and Fast edits until Apply submits one choice", () => {
  const { view, onApplySettings, onClose } = mount();
  expect(view.getByTestId("compose-model-menu").props.expanded).toBe(true);
  expect(
    view.getByRole("button", { name: "Apply model settings" }).props.accessibilityState,
  ).toEqual({
    disabled: true,
  });
  fireEvent.press(view.getByRole("switch", { name: "Fast mode" }));
  expect(onApplySettings).not.toHaveBeenCalled();
  const disclosure = view.getByRole("button", { name: "Choose model, GPT-6 Sol" });
  expect(disclosure.props.accessibilityState.expanded).toBe(false);
  fireEvent.press(disclosure);
  fireEvent.press(view.getByRole("button", { name: "GPT-6 Astra" }));
  expect(
    view.getByRole("button", { name: "Choose model, GPT-6 Astra" }).props.accessibilityState,
  ).toEqual({ expanded: false });
  expect(onApplySettings).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole("button", { name: "Apply model settings" }));
  expect(onApplySettings).toHaveBeenCalledTimes(1);
  expect(onApplySettings).toHaveBeenCalledWith({
    effort: "high",
    executionChanged: true,
    model: "astra",
    personality: null,
    serviceTier: null,
  });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("discards Fast and effort edits when dismissed", () => {
  const { view, onApplySettings, onClose } = mount();
  fireEvent.press(view.getByRole("switch", { name: "Fast mode" }));
  fireEvent(view.getByLabelText("Thinking level, High"), "accessibilityAction", {
    nativeEvent: { actionName: "increment" },
  });
  expect(view.getByLabelText("Thinking level, Max")).toBeVisible();
  fireEvent(view.getByTestId("compose-model-menu"), "dismissRequest");
  expect(onApplySettings).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByRole("button", { name: "Model and thinking" }));
  expect(view.getByLabelText("Thinking level, High")).toBeVisible();
  expect(view.getByRole("switch", { name: "Fast mode" }).props.accessibilityState).toEqual({
    checked: false,
  });
});

it("shows only end labels and the current tooltip; drag commits on Apply", () => {
  const { view, onApplySettings } = mount();
  expect(view.getByText("Low")).toBeVisible();
  expect(view.getByText("Ultra")).toBeVisible();
  expect(view.getByText("High")).toBeVisible();
  expect(view.queryByText("Medium")).toBeNull();
  fireEvent(view.getByLabelText("Thinking level, High"), "layout", {
    nativeEvent: { layout: { width: 300 } },
  });
  act(() =>
    fireGestureHandler<ReturnType<typeof Gesture.Pan>>(getByGestureTestId("thinking-level-pan"), [
      { state: State.BEGAN, x: 150, absoluteX: 250, numberOfPointers: 1 },
      { state: State.ACTIVE, x: 20, absoluteX: 350, numberOfPointers: 1 },
      { state: State.ACTIVE, x: 5, absoluteX: 900, numberOfPointers: 1 },
      { state: State.END, x: 5, absoluteX: 900, numberOfPointers: 1 },
    ]),
  );
  expect(view.getByLabelText("Thinking level, Ultra")).toBeVisible();
  expect(onApplySettings).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole("button", { name: "Apply model settings" }));
  expect(onApplySettings).toHaveBeenCalledWith({
    effort: "ultra",
    executionChanged: true,
    model: "sol",
    personality: null,
    serviceTier: null,
  });
  expect(sliderStopAt(-100, 300, 5)).toBe(0);
  expect(sliderStopAt(400, 300, 5)).toBe(4);
  expect(sliderStopAt(150, 300, 5)).toBe(2);
  expect(sliderStopCenter(0, 300, 5)).toBe(18);
  expect(sliderStopCenter(4, 300, 5)).toBe(282);
  expect(sliderProgressAt(84, 300)).toBe(0.25);
});

it("selects a stop with a touch without needing a drag", () => {
  const { view, onApplySettings } = mount();
  fireEvent(view.getByLabelText("Thinking level, High"), "layout", {
    nativeEvent: { layout: { width: 300 } },
  });
  act(() =>
    fireGestureHandler<ReturnType<typeof Gesture.Pan>>(getByGestureTestId("thinking-level-pan"), [
      { state: State.BEGAN, x: 36, absoluteX: 136, numberOfPointers: 1 },
      { state: State.ACTIVE, x: 36, absoluteX: 136, numberOfPointers: 1 },
      { state: State.END, x: 36, absoluteX: 136, numberOfPointers: 1 },
    ]),
  );
  expect(view.getByLabelText("Thinking level, Low")).toBeVisible();
  fireEvent.press(view.getByRole("button", { name: "Apply model settings" }));
  expect(onApplySettings).toHaveBeenCalledWith(
    expect.objectContaining({ effort: "low", model: "sol" }),
  );
});

it("keeps the reached effort when an active drag is interrupted", () => {
  const { view, onApplySettings } = mount();
  fireEvent(view.getByLabelText("Thinking level, High"), "layout", {
    nativeEvent: { layout: { width: 300 } },
  });
  act(() =>
    fireGestureHandler<ReturnType<typeof Gesture.Pan>>(getByGestureTestId("thinking-level-pan"), [
      { state: State.BEGAN, x: 150, absoluteX: 250, numberOfPointers: 1 },
      { state: State.ACTIVE, x: 270, absoluteX: 370, numberOfPointers: 1 },
      { state: State.CANCELLED, x: 270, absoluteX: 370, numberOfPointers: 1 },
    ]),
  );
  expect(view.getByLabelText("Thinking level, Ultra")).toBeVisible();
  expect(onApplySettings).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole("button", { name: "Apply model settings" }));
  expect(onApplySettings).toHaveBeenCalledWith(
    expect.objectContaining({ effort: "ultra", model: "sol" }),
  );
});

it("follows the controlled selection when it changes outside a gesture", () => {
  const onSelect = jest.fn();
  const renderSlider = (selected: string) => (
    <CodeWideSlider
      accessibilityLabel="Volume"
      formatValue={(value) => value}
      onSelect={onSelect}
      selected={selected}
      testID="volume"
      values={["quiet", "normal", "loud"]}
    />
  );
  const view = render(renderSlider("normal"));
  fireEvent(view.getByLabelText("Volume, normal"), "layout", {
    nativeEvent: { layout: { width: 300 } },
  });
  act(() =>
    fireGestureHandler<ReturnType<typeof Gesture.Pan>>(getByGestureTestId("volume-pan"), [
      { state: State.BEGAN, x: 150, absoluteX: 250, numberOfPointers: 1 },
      { state: State.ACTIVE, x: 270, absoluteX: 370, numberOfPointers: 1 },
      { state: State.END, x: 270, absoluteX: 370, numberOfPointers: 1 },
    ]),
  );
  expect(view.getByLabelText("Volume, loud")).toBeVisible();
  view.rerender(renderSlider("quiet"));
  expect(view.getByLabelText("Volume, quiet")).toBeVisible();
});

it("commits only the final stop to the controlled draft after a drag", () => {
  const onSelect = jest.fn();
  function ControlledVolume(): ReactNode {
    const [selected, setSelected] = useState("normal");
    return (
      <CodeWideSlider
        accessibilityLabel="Volume"
        formatValue={(value) => value}
        onSelect={(value) => {
          onSelect(value);
          setSelected(value);
        }}
        selected={selected}
        testID="volume"
        values={["quiet", "normal", "loud"]}
      />
    );
  }
  const view = render(<ControlledVolume />);
  fireEvent(view.getByLabelText("Volume, normal"), "layout", {
    nativeEvent: { layout: { width: 300 } },
  });
  act(() =>
    fireGestureHandler<ReturnType<typeof Gesture.Pan>>(getByGestureTestId("volume-pan"), [
      { state: State.BEGAN, x: 150, absoluteX: 250, numberOfPointers: 1 },
      { state: State.ACTIVE, x: 282, absoluteX: 382, numberOfPointers: 1 },
      { state: State.ACTIVE, x: 18, absoluteX: 118, numberOfPointers: 1 },
      { state: State.END, x: 18, absoluteX: 118, numberOfPointers: 1 },
    ]),
  );
  expect(onSelect.mock.calls).toEqual([["quiet"]]);
  expect(view.getByLabelText("Volume, quiet")).toBeVisible();
});

it("uses the lift position when a fast drag ends beyond its last update", () => {
  const onSelect = jest.fn();
  const view = render(
    <CodeWideSlider
      accessibilityLabel="Volume"
      formatValue={(value) => value}
      onSelect={onSelect}
      selected="normal"
      testID="volume"
      values={["quiet", "normal", "loud"]}
    />,
  );
  fireEvent(view.getByLabelText("Volume, normal"), "layout", {
    nativeEvent: { layout: { width: 300 } },
  });
  act(() =>
    fireGestureHandler<ReturnType<typeof Gesture.Pan>>(getByGestureTestId("volume-pan"), [
      { state: State.BEGAN, x: 150, absoluteX: 250, numberOfPointers: 1 },
      { state: State.ACTIVE, x: 180, absoluteX: 280, numberOfPointers: 1 },
      { state: State.END, x: 282, absoluteX: 382, numberOfPointers: 1 },
    ]),
  );
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onSelect).toHaveBeenCalledWith("loud");
  expect(view.getByLabelText("Volume, loud")).toBeVisible();
});

it("uses a short, full-width rounded Apply button", () => {
  const { view } = mount();
  const button = view.getByRole("button", { name: "Apply model settings" });
  expect(StyleSheet.flatten(button.props.style)).toEqual(
    expect.objectContaining({
      alignSelf: "stretch",
      borderRadius: radii.pill,
      minHeight: controlSize.compact,
    }),
  );
});

it("follows a drag back from the last stop without jumping", () => {
  const { view, onApplySettings } = mount();
  fireEvent(view.getByLabelText("Thinking level, High"), "layout", {
    nativeEvent: { layout: { width: 300 } },
  });
  act(() =>
    fireGestureHandler<ReturnType<typeof Gesture.Pan>>(getByGestureTestId("thinking-level-pan"), [
      { state: State.BEGAN, x: 150, absoluteX: 250, numberOfPointers: 1 },
      { state: State.ACTIVE, x: 270, absoluteX: 370, numberOfPointers: 1 },
      { state: State.ACTIVE, x: 18, absoluteX: 118, numberOfPointers: 1 },
      { state: State.END, x: 18, absoluteX: 118, numberOfPointers: 1 },
    ]),
  );
  expect(view.getByLabelText("Thinking level, Low")).toBeVisible();
  expect(onApplySettings).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole("button", { name: "Apply model settings" }));
  expect(onApplySettings).toHaveBeenCalledWith(
    expect.objectContaining({ effort: "low", model: "sol" }),
  );
});

it("applies a Fast-only change through Apply", () => {
  const { view, onApplySettings } = mount("priority");
  fireEvent.press(view.getByRole("switch", { name: "Fast mode" }));
  expect(onApplySettings).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole("button", { name: "Apply model settings" }));
  expect(onApplySettings).toHaveBeenCalledWith({
    effort: "high",
    executionChanged: true,
    model: "sol",
    personality: null,
    serviceTier: "default",
  });
});

it("uses the same slider for values outside the model menu", () => {
  const onSelect = jest.fn();
  const view = render(
    <CodeWideSlider
      accessibilityLabel="Volume"
      formatValue={(value) => `${value.charAt(0).toUpperCase()}${value.slice(1)}`}
      onSelect={onSelect}
      selected="normal"
      testID="volume"
      values={["quiet", "normal", "loud"]}
    />,
  );

  expect(view.getByText("Quiet")).toBeVisible();
  expect(view.getByText("Loud")).toBeVisible();
  expect(view.getByLabelText("Volume, Normal")).toBeVisible();
  expect(view.getByTestId("volume-track")).toHaveStyle({
    backgroundColor: "rgba(120,120,128,0.22)",
    borderRadius: 10,
    height: 40,
    overflow: "hidden",
  });
  expect(view.getByTestId("volume-fill")).toHaveStyle({
    backgroundColor: "rgba(255,255,255,0.16)",
  });
  expect(view.getByTestId("volume-thumb")).toHaveStyle({
    backgroundColor: "#ffffff",
    borderRadius: 3,
    height: 20,
    width: 6,
  });
  fireEvent(view.getByLabelText("Volume, Normal"), "accessibilityAction", {
    nativeEvent: { actionName: "increment" },
  });
  expect(view.getByLabelText("Volume, Loud")).toBeVisible();
  expect(onSelect).toHaveBeenCalledWith("loud");
});
