import { fireEvent, render } from "@testing-library/react-native";
import { seedThreadExecutionSettings } from "@codewide/sync-client";

import { ComposerControlChips } from "../src/features/composer/settings/ComposerControlChips";
import { createV1TestThread } from "./fixtures/v1Thread";

// WHY: The menu's own selection behavior is covered separately; this test exercises
// the composer chip while a durable settings command awaits server confirmation.
jest.mock("../src/ui/TurnControlMenus", () => ({
  ModelThinkingMenu: (props: {
    onApplySettings: (choice: {
      effort: string;
      executionChanged: true;
      model: string;
      personality: null;
      serviceTier: null;
    }) => void;
    triggerChildren: React.ReactNode;
  }) => {
    const React = require("react");
    const Native = require("react-native");
    return React.createElement(
      Native.Pressable,
      {
        accessibilityLabel: "Choose Astra",
        onPress: () =>
          props.onApplySettings({
            effort: "high",
            executionChanged: true,
            model: "astra",
            personality: null,
            serviceTier: null,
          }),
      },
      props.triggerChildren,
    );
  },
  PermissionsMenu: () => null,
}));

it("keeps a selected model visible until the thread confirms it", () => {
  const thread = createV1TestThread("thread", "project", 1, []);
  seedThreadExecutionSettings(thread, {
    effort: "medium",
    model: "sol",
    permissions: null,
    serviceTier: null,
  });
  const onApplySettings = jest.fn();
  const props = {
    cwd: "/workspace",
    error: null,
    newChat: false,
    onApplySettings,
    onClose: jest.fn(),
    onFallback: jest.fn(),
    onQuickOpen: jest.fn(),
    onSelectPermissions: jest.fn(),
    readOnly: false,
    remoteThread: thread,
    resourceId: null,
    resources: null,
    selectedEffort: null,
    selectedModel: null,
    selectedPermissions: null,
    selectedPersonality: null,
    selectedServiceTier: undefined,
  };
  const view = render(<ComposerControlChips {...props} />);
  expect(view.getByTestId("composer-model-label")).toHaveTextContent("sol · medium");

  fireEvent.press(view.getByLabelText("Choose Astra"));
  expect(onApplySettings).toHaveBeenCalledTimes(1);
  expect(view.getByTestId("composer-model-label")).toHaveTextContent("astra · high · Updating…");

  seedThreadExecutionSettings(thread, {
    effort: "high",
    model: "astra",
    permissions: null,
    serviceTier: null,
  });
  view.rerender(<ComposerControlChips {...props} />);
  expect(view.getByTestId("composer-model-label")).toHaveTextContent("astra · high");
  expect(view.getByTestId("composer-model-label")).not.toHaveTextContent("Updating…");

  seedThreadExecutionSettings(thread, {
    effort: "medium",
    model: "sol",
    permissions: null,
    serviceTier: null,
  });
  view.rerender(<ComposerControlChips {...props} />);
  expect(view.getByTestId("composer-model-label")).toHaveTextContent("sol · medium");
});
