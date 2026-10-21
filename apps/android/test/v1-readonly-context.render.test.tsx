import { render, waitFor } from "@testing-library/react-native";
import { Text, TextInput } from "react-native";

jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "/cache/",
  getInfoAsync: async () => ({ exists: false }),
}));

import type { TurnControlsValue } from "../src/data/turn-controls-types";
import { createWorkspaceResourceDatabase } from "../src/data/workspace-resource-database";
import { turnControlsResourceKey } from "../src/data/workspace-resource-keys";
import { ReadOnlyComposerContext } from "../src/features/composer/ReadOnlyComposerContext";
import { createV1TestThread } from "./fixtures/v1Thread";

it("keeps execution metadata and supplied tool access without creating an editable composer", () => {
  const thread = createV1TestThread("child", "parent", 1, []);
  const view = render(
    <ReadOnlyComposerContext
      connectionId="connection"
      loadControls={undefined}
      notice="Subagent chats are read-only"
      thread={thread}
      workspaceResources={null}
    >
      <Text>Terminal access</Text>
    </ReadOnlyComposerContext>,
  );
  expect(view.getByTestId("readonly-model-chip")).toBeVisible();
  expect(view.getByTestId("composer-model-label")).toHaveTextContent("Model not confirmed");
  expect(view.getByText("Terminal access")).toBeVisible();
  expect(view.getByLabelText("Subagent chats are read-only")).toBeVisible();
  expect(view.UNSAFE_queryAllByType(TextInput)).toHaveLength(0);
  expect(view.queryByLabelText("Send message")).toBeNull();
});

it("labels the child's model from the composer catalog and keeps both chips disabled", async () => {
  const thread = { ...createV1TestThread("child", "parent", 1, []), model: "default" };
  const catalog: TurnControlsValue = {
    defaults: { effort: null, model: null, permissions: null, serviceTier: null },
    models: [
      {
        defaultEffort: null,
        efforts: [],
        id: "default",
        isDefault: true,
        label: "Default (Opus)",
        provider: null,
        supportsPersonality: false,
      },
    ],
    permissions: [],
    skills: [],
  };
  const resources = createWorkspaceResourceDatabase();
  resources.putTurnControls({
    connectionId: "connection",
    cwd: thread.cwd,
    error: null,
    id: turnControlsResourceKey("connection", thread.cwd),
    status: "ready",
    value: catalog,
  });
  const view = render(
    <ReadOnlyComposerContext
      connectionId="connection"
      loadControls={async () => catalog}
      notice="Subagent chats are read-only"
      thread={thread}
      workspaceResources={resources}
    >
      {null}
    </ReadOnlyComposerContext>,
  );
  await waitFor(() => {
    expect(view.getByTestId("composer-model-label")).toHaveTextContent("Default (Opus)");
  });
  expect(view.getByTestId("readonly-model-chip")).toBeDisabled();
  expect(view.getByTestId("readonly-permissions-chip")).toBeDisabled();
});
