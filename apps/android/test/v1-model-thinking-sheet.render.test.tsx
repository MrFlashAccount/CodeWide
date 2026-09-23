import { fireEvent, render } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { ModelThinkingMenu } from "../src/ui/TurnControlMenus";

// WHY: Node cannot mount Expo's native sheet window; only the host is replaced.
jest.mock("@expo/ui/community/bottom-sheet", () => {
  const { ScrollView, View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    BottomSheet: ({ children }: { children: ReactNode }) => <View>{children}</View>,
    BottomSheetScrollView: ScrollView,
    BottomSheetView: View,
  };
});

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

it("keeps model, Fast, and Ultra as independent controls in the compact sheet", () => {
  const onSelectEffort = jest.fn();
  const onSelectModel = jest.fn();
  const onSelectServiceTier = jest.fn();
  const view = render(
    <ModelThinkingMenu
      accessibilityLabel="Model and thinking"
      error={null}
      loading={false}
      models={models}
      onClose={jest.fn()}
      onFallbackPress={jest.fn()}
      onOpen={jest.fn()}
      onSelectEffort={onSelectEffort}
      onSelectModel={onSelectModel}
      onSelectPersonality={jest.fn()}
      onSelectServiceTier={onSelectServiceTier}
      selectedEffort="high"
      selectedModel="sol"
      selectedPersonality={null}
      selectedServiceTier={null}
      triggerChildren={<Text>GPT-6 Sol · high</Text>}
      triggerStyle={{}}
    />,
  );
  fireEvent(view.getByRole("button", { name: "Model and thinking" }), "click");
  expect(view.getByRole("button", { name: "Choose model, GPT-6 Sol" })).toBeVisible();
  fireEvent(view.getByRole("switch", { name: "Fast mode" }), "click");
  expect(onSelectServiceTier).toHaveBeenCalledWith("priority");
  expect(onSelectModel).not.toHaveBeenCalled();
  fireEvent(view.getByLabelText("Thinking level, High"), "accessibilityAction", { nativeEvent: { actionName: "increment" } });
  expect(onSelectEffort).toHaveBeenCalledWith("max");
  expect(view.queryByText("Medium")).toBeNull();
  expect(view.getByText("Ultra")).toBeVisible();
  fireEvent(view.getByRole("button", { name: "Choose model, GPT-6 Sol" }), "click");
  fireEvent(view.getByRole("button", { name: "GPT-6 Astra" }), "click");
  expect(onSelectModel).toHaveBeenCalledWith("astra", "high");
});

it("requests standard routing when Fast is the model default", () => {
  const onSelectServiceTier = jest.fn();
  const sol = models[0];
  if (sol === undefined) { throw new Error("Sol model fixture is absent"); }
  const view = render(
    <ModelThinkingMenu
      accessibilityLabel="Model and thinking"
      error={null}
      loading={false}
      models={[{ ...sol, defaultServiceTier: "priority" }]}
      onClose={jest.fn()}
      onFallbackPress={jest.fn()}
      onOpen={jest.fn()}
      onSelectEffort={jest.fn()}
      onSelectModel={jest.fn()}
      onSelectPersonality={jest.fn()}
      onSelectServiceTier={onSelectServiceTier}
      selectedEffort="high"
      selectedModel="sol"
      selectedPersonality={null}
      selectedServiceTier="priority"
      triggerChildren={<Text>Sol</Text>}
      triggerStyle={{}}
    />,
  );
  fireEvent(view.getByRole("button", { name: "Model and thinking" }), "click");
  fireEvent(view.getByRole("switch", { name: "Fast mode" }), "click");
  expect(onSelectServiceTier).toHaveBeenCalledWith("default");
});
