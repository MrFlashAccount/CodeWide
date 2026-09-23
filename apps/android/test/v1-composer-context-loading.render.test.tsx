import { render } from "@testing-library/react-native";

import type { TurnControlsValue } from "../src/data/turn-controls-types";
import { ComposerControlChips } from "../src/features/composer/settings/ComposerControlChips";
import { ComposerPortContextChipView } from "../src/features/ports/ComposerPortContextChip";

const action = jest.fn();

it("shimmers model and access labels until their controls resource is available", () => {
  const view = render(
    <ComposerControlChips
      cwd="/workspace"
      error={null}
      load={() => new Promise<TurnControlsValue>(() => undefined)}
      newChat={false}
      onClose={action}
      onFallback={action}
      onQuickOpen={action}
      onSelectEffort={action}
      onSelectModel={action}
      onSelectPermissions={action}
      onSelectPersonality={action}
      onSelectServiceTier={action}
      readOnly={false}
      remoteThread={null}
      resourceId="pending-controls"
      resources={null}
      selectedEffort="high"
      selectedModel="restored-model-id"
      selectedPermissions=":workspace"
      selectedPersonality={null}
      selectedServiceTier={null}
    />,
  );

  expect(view.getByLabelText("Loading model")).toBeVisible();
  expect(view.getByTestId("composer-model-label")).toHaveProp(
    "accessibilityLabel",
    "Loading model…",
  );
  expect(view.getByLabelText("Loading access")).toBeVisible();
  expect(view.getByTestId("composer-permissions-label")).toHaveProp(
    "accessibilityLabel",
    "Loading access…",
  );
});

it("keeps the ports chip visible with shimmer while profiles load", () => {
  const view = render(
    <ComposerPortContextChipView
      onOpen={action}
      snapshot={{
        discoveredPorts: [],
        discoveryError: null,
        discoveryStatus: "loading",
        profiles: [],
        profilesStatus: "loading",
      }}
    />,
  );

  expect(view.getByRole("button", { name: "Loading ports…" })).toHaveProp("accessibilityState", {
    busy: true,
  });
  expect(view.getByTestId("composer-ports-label")).toHaveProp(
    "accessibilityLabel",
    "Loading ports…",
  );
});

it("hides an empty ports chip only after profile loading settles", () => {
  const view = render(
    <ComposerPortContextChipView
      onOpen={action}
      snapshot={{
        discoveredPorts: [],
        discoveryError: null,
        discoveryStatus: "ready",
        profiles: [],
        profilesStatus: "ready",
      }}
    />,
  );

  expect(view.toJSON()).toBeNull();
});
