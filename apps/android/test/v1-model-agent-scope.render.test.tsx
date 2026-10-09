import { fireEvent, render } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Text } from "react-native";

import { parseAgentProviderId } from "../src/data/threadAgent";
import type { TurnControlsValue } from "../src/data/turn-controls-types";
import { EMPTY_TURN_CONTROLS } from "../src/features/composer/settings";
import { modelAgentScope } from "../src/features/composer/settings/modelAgentScope";
import { ModelThinkingMenu } from "../src/ui/TurnControlMenus";
import type { ModelAgentScope } from "../src/ui/TurnControlMenus.types";

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

const codex = parseAgentProviderId("codex");
const claude = parseAgentProviderId("claude");
if (codex === null || claude === null) throw new Error("invalid provider fixture");

const row = (
  id: string,
  label: string,
  provider: TurnControlsValue["models"][number]["provider"],
) => ({
  defaultEffort: "high",
  efforts: ["high"],
  id,
  isDefault: false,
  label,
  provider,
  serviceTiers: [],
  supportsPersonality: false,
});
const multiProvider: TurnControlsValue = {
  ...EMPTY_TURN_CONTROLS,
  models: [
    row("gpt-5.5", "GPT-5.5", codex),
    row("opus", "Opus", claude),
    row("sonnet", "Sonnet", claude),
  ],
};

function openPicker(agentScope: ModelAgentScope | null, models = multiProvider.models) {
  const view = render(
    <ModelThinkingMenu
      accessibilityLabel="Model and thinking"
      agentScope={agentScope}
      error={null}
      loading={false}
      models={models}
      onApplySettings={jest.fn()}
      onClose={jest.fn()}
      onFallbackPress={jest.fn()}
      onOpen={jest.fn()}
      selectedEffort="high"
      selectedModel={models[0]?.id ?? null}
      selectedPersonality={null}
      selectedServiceTier={null}
      triggerChildren={<Text>Model</Text>}
      triggerStyle={{}}
    />,
  );
  fireEvent.press(view.getByRole("button", { name: "Model and thinking" }));
  fireEvent.press(view.getByRole("button", { name: /^Choose model/ }));
  return view;
}

const claudeThread = {
  codewideAgent: {
    capabilities: { "threads.crossProviderFork": true },
    primary: false,
    provider: "claude",
    providerName: "Claude",
  },
};
const codexThread = {
  codewideAgent: { capabilities: {}, primary: true, provider: "codex", providerName: "Codex" },
};

it("groups a new chat's models by provider and says the agent is final", () => {
  const scope = modelAgentScope(multiProvider, true, null);
  expect(scope).toEqual({ kind: "newChat" });
  const view = openPicker(scope);
  expect(view.getByTestId("model-agent-note")).toHaveTextContent(
    "The agent can't be changed after the chat starts. To continue with another agent, fork the chat into it.",
  );
  const codexHeader = view.getByTestId("model-provider-section-codex");
  const claudeHeader = view.getByTestId("model-provider-section-claude");
  expect(codexHeader).toHaveTextContent("Codex");
  expect(claudeHeader).toHaveTextContent("Claude");
  expect(view.getAllByRole("header")).toHaveLength(2);
  expect(view.getByRole("button", { name: "Opus" })).toBeTruthy();
});

it("names the agent of an existing thread and points to fork when it can switch", () => {
  const claudeScope = modelAgentScope(multiProvider, false, claudeThread);
  const claudeView = openPicker(claudeScope, multiProvider.models.slice(1));
  expect(claudeView.getByTestId("model-agent-note")).toHaveTextContent(
    "This chat uses Claude. Fork it from the thread menu to switch agents.",
  );
  expect(claudeView.queryAllByRole("header")).toHaveLength(0);

  const codexView = openPicker(modelAgentScope(multiProvider, false, codexThread));
  expect(codexView.getByTestId("model-agent-note")).toHaveTextContent("This chat uses Codex.");
});

it("keeps a single-provider or legacy picker unchanged", () => {
  const legacy: TurnControlsValue = {
    ...EMPTY_TURN_CONTROLS,
    models: [row("gpt-5.5", "GPT-5.5", null), row("gpt-5.4", "GPT-5.4", null)],
  };
  expect(modelAgentScope(legacy, true, null)).toBeNull();
  expect(modelAgentScope(legacy, false, { id: "legacy-thread" })).toBeNull();
  const view = openPicker(null, legacy.models);
  expect(view.queryByTestId("model-agent-note")).toBeNull();
  expect(view.queryAllByRole("header")).toHaveLength(0);
  expect(view.getByRole("button", { name: "GPT-5.4" })).toBeTruthy();
});
