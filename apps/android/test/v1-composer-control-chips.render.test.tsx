import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { Thread, Turn } from "@codewide/codex-protocol/v0.155.1/v2";
import { seedThreadExecutionSettings } from "@codewide/sync-client";
import { Text } from "react-native";

// WHY: The catalog row is the turn-controls resource's published value; these
// tests set it directly instead of driving the persistent resource collection.
let mockCatalog: unknown = null;
jest.mock("../src/data/use-workspace-resource-row", () => ({
  useTurnControlsRow: () =>
    mockCatalog === null
      ? null
      : {
          connectionId: "connection",
          cwd: "/workspace",
          error: null,
          id: "controls",
          status: "ready",
          updatedAt: 1,
          value: mockCatalog,
        },
}));

// WHY: The native menus are covered by their own suites; these doubles expose the
// chips' selection commands and the values the menus receive.
jest.mock("../src/ui/TurnControlMenus", () => {
  const React = require("react");
  const Native = require("react-native");
  const button = (label: string, onPress: () => void) =>
    React.createElement(Native.Pressable, { accessibilityLabel: label, key: label, onPress });
  return {
    ModelThinkingMenu: (props: {
      models: readonly object[];
      onApplySettings: (choice: object) => void;
      selectedEffort: string | null;
      selectedModel: string | null;
      triggerChildren: React.ReactNode;
    }) =>
      React.createElement(
        Native.View,
        null,
        props.triggerChildren,
        button("Apply Sol high", () =>
          props.onApplySettings({
            effort: "high",
            executionChanged: true,
            model: "sol",
            personality: null,
            serviceTier: null,
          }),
        ),
        button("Enable Fast", () =>
          props.onApplySettings({
            effort: "medium",
            executionChanged: true,
            model: "sol",
            personality: null,
            serviceTier: "fast",
          }),
        ),
        button("Apply Haiku", () =>
          props.onApplySettings({
            effort: null,
            executionChanged: true,
            model: "haiku",
            personality: null,
            serviceTier: null,
          }),
        ),
        button("Apply Opus max", () =>
          props.onApplySettings({
            effort: "max",
            executionChanged: true,
            model: "opus",
            personality: null,
            serviceTier: null,
          }),
        ),
        React.createElement(
          Native.Text,
          { testID: "menu-model-count" },
          `models:${props.models.length}`,
        ),
        React.createElement(
          Native.Text,
          { testID: "menu-model" },
          `${props.selectedModel ?? "none"}/${props.selectedEffort ?? "none"}`,
        ),
      ),
    PermissionsMenu: (props: {
      accessibilityLabel: string;
      onSelectPermissions: (permissions: string | null) => void;
      selectedPermissions: string | null;
      serverDefault:
        | { kind: "draft"; resolved: string | null; selected: boolean }
        | { kind: "reset"; resolved: string }
        | { kind: "unavailable" };
      triggerChildren: React.ReactNode;
    }) =>
      React.createElement(
        Native.View,
        { accessibilityLabel: props.accessibilityLabel, accessible: true },
        props.triggerChildren,
        button("Choose full access", () => props.onSelectPermissions(":full-access")),
        button("Choose read only", () => props.onSelectPermissions(":read-only")),
        button("Choose server default", () => {
          const option = props.serverDefault;
          if (option.kind === "draft") props.onSelectPermissions(null);
          else if (option.kind === "reset") props.onSelectPermissions(option.resolved);
        }),
        React.createElement(
          Native.Text,
          { testID: "menu-permissions" },
          `${props.selectedPermissions ?? "none"}|${JSON.stringify(props.serverDefault)}`,
        ),
      ),
  };
});

import { NativeCommandRejectedError } from "../src/data/nativeCommandSettlement";
import type { ThreadSettings, TurnControlsValue } from "../src/data/turn-controls-types";
import { useComposerSession } from "../src/features/composer/composerSession";
import { EMPTY_COMPOSER_PREFERENCES } from "../src/features/composer/draft";
import { useComposerSettings } from "../src/features/composer/settings";
import { ComposerControlChips } from "../src/features/composer/settings/ComposerControlChips";
import { createV1TestThread } from "./fixtures/v1Thread";

const CONTROLS_ID = "controls";

const row = (
  id: string,
  provider: string | null,
  defaultEffort: string | null,
  efforts: string[],
  isDefault = false,
) => ({
  defaultEffort,
  defaultServiceTier: null,
  efforts,
  id,
  isDefault,
  label: id,
  provider,
  serviceTiers: [],
  supportsPersonality: false,
});

const multiProvider = {
  defaults: { effort: "medium", model: "sol", permissions: ":read-only", serviceTier: null },
  models: [
    {
      ...row("sol", "codex", "medium", ["medium", "high"], true),
      serviceTiers: [{ description: "", id: "priority", name: "Fast" }],
    },
    row("opus", "claude", "high", ["low", "high", "max"]),
    row("haiku", "claude", null, []),
  ],
  permissions: [
    { allowed: true, description: null, id: ":read-only", providers: ["codex", "claude"] },
    { allowed: true, description: null, id: ":workspace", providers: ["codex", "claude"] },
    { allowed: true, description: null, id: ":full-access", providers: ["codex", "claude"] },
  ],
  skills: [],
} as unknown as TurnControlsValue;

const legacy = {
  ...multiProvider,
  models: [row("sol", null, "medium", ["medium", "high"], true)],
  permissions: [{ allowed: true, description: null, id: ":workspace", providers: null }],
} as unknown as TurnControlsValue;

function resourcesWith(controls: TurnControlsValue) {
  mockCatalog = controls;
  return null;
}

const claudeAgent = {
  capabilities: { "threads.crossProviderFork": true },
  primary: false,
  provider: "claude",
  providerName: "Claude",
};
const codexAgent = { capabilities: {}, primary: true, provider: "codex", providerName: "Codex" };

function thread(
  settings: {
    effort: string | null;
    model: string;
    permissions: string | null;
    serviceTier?: string | null;
  },
  agent: object | null,
  turns: Turn[] = [],
): Thread {
  const value = createV1TestThread("thread", null, 1, turns);
  seedThreadExecutionSettings(value, {
    ...settings,
    approvalPolicy: settings.permissions === null ? "on-request" : null,
    sandboxPolicy: settings.permissions === null ? "workspaceWrite" : null,
    serviceTier: settings.serviceTier ?? null,
  });
  return agent === null ? value : Object.assign(value, { codewideAgent: agent });
}

function runningTurn(): Turn {
  return { id: "turn-1", items: [], status: "inProgress" } as unknown as Turn;
}

type HarnessProps = {
  readonly newChat?: boolean;
  readonly onUpdateSettings?: (settings: ThreadSettings) => Promise<void>;
  readonly permissions?: string | null;
  readonly remoteThread: Thread | null;
  readonly resources: null;
};

const owner = { hasReplacement: () => false, isCurrent: () => true };

/** The real settings owner wired to the real chips, as the composer composes them. */
function Harness({
  newChat = false,
  onUpdateSettings,
  permissions = null,
  remoteThread,
  resources,
}: HarnessProps) {
  const session = useComposerSession("scope", {
    attachments: [],
    plainText: "",
    preferences: { ...EMPTY_COMPOSER_PREFERENCES, permissions },
  });
  const settings = useComposerSettings({
    composerPreferences: session.snapshot.preferences,
    composerScope: "scope",
    composerSession: session,
    controlsResourceId: CONTROLS_ID,
    conversationOwner: owner,
    cwd: "/workspace",
    draftConnectionId: null,
    draftThreadId: null,
    newChat,
    onLoadControls: undefined,
    onUpdateSettings,
    remoteThread,
    saveComposerPreferences: undefined,
    workspaceResources: resources,
  });
  return (
    <>
      <ComposerControlChips
        controls$={settings.controls$}
        cwd="/workspace"
        error={settings.controlError}
        newChat={newChat}
        onApplySettings={settings.applyModelSettings}
        onClose={jest.fn()}
        onFallback={jest.fn()}
        onQuickOpen={jest.fn()}
        onSelectPermissions={settings.selectPermissions}
        readOnly={false}
        remoteThread={remoteThread}
        resourceId={CONTROLS_ID}
        resources={resources}
        selectedEffort={settings.selectedEffort}
        selectedModel={settings.selectedModel}
        selectedPermissions={settings.selectedPermissions}
        selectedPersonality={settings.selectedPersonality}
        selectedServiceTier={settings.selectedServiceTier}
      />
      <Text testID="control-error">{settings.controlError ?? ""}</Text>
    </>
  );
}

function deferred() {
  let resolve: () => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}

async function press(view: ReturnType<typeof render>, label: string) {
  await act(async () => {
    fireEvent.press(view.getByLabelText(label));
    await Promise.resolve();
  });
}

/** Waits until the chips read the catalog row (a live query publishes it after mount). */
async function catalogLoaded(view: ReturnType<typeof render>, models: number) {
  await waitFor(() => {
    expect(view.getByTestId("menu-model-count")).toHaveTextContent(`models:${models}`);
  });
}

const accessLabel = (view: ReturnType<typeof render>) =>
  view.getByTestId("composer-permissions-label");
const modelLabel = (view: ReturnType<typeof render>) => view.getByTestId("composer-model-label");

describe("Codex thread", () => {
  it("shows the thread's server access, not a stale local preference", async () => {
    const resources = resourcesWith(multiProvider);
    const remoteThread = thread(
      { effort: "high", model: "sol", permissions: ":workspace" },
      codexAgent,
    );
    const view = render(
      <Harness permissions=":full-access" remoteThread={remoteThread} resources={resources} />,
    );
    await catalogLoaded(view, 1);
    await waitFor(() => {
      expect(accessLabel(view)).toHaveTextContent("Workspace");
    });
    expect(modelLabel(view)).toHaveTextContent("sol · High");
    expect(view.getByTestId("menu-permissions")).toHaveTextContent(
      ':workspace|{"kind":"reset","resolved":":read-only"}',
    );
  });

  it("shimmers an optimistic access change until the server echoes it", async () => {
    const resources = resourcesWith(multiProvider);
    const remoteThread = thread(
      { effort: "high", model: "sol", permissions: ":workspace" },
      codexAgent,
    );
    const update = deferred();
    const onUpdateSettings = jest.fn(async () => update.promise);
    const view = render(
      <Harness
        onUpdateSettings={onUpdateSettings}
        remoteThread={remoteThread}
        resources={resources}
      />,
    );
    await catalogLoaded(view, 1);
    await waitFor(() => {
      expect(accessLabel(view)).toHaveTextContent("Workspace");
    });
    await press(view, "Choose full access");
    expect(onUpdateSettings).toHaveBeenCalledWith({ permissions: ":full-access" });
    expect(accessLabel(view)).toHaveTextContent("Full access");
    // The shimmer keeps the value and exposes it as its accessibility label.
    expect(accessLabel(view)).toHaveProp("accessibilityLabel", "Full access");

    await act(async () => {
      update.resolve();
      await update.promise;
    });
    const echoed = thread(
      {
        effort: "high",
        model: "sol",
        permissions: ":full-access",
      },
      codexAgent,
    );
    view.rerender(
      <Harness onUpdateSettings={onUpdateSettings} remoteThread={echoed} resources={resources} />,
    );
    expect(accessLabel(view)).toHaveTextContent("Full access");
    expect(accessLabel(view)).not.toHaveProp("accessibilityLabel");
    // Codex applies access to subsequent turns; the thread is idle, so no marker.
    expect(view.queryByTestId("composer-permissions-next-turn")).toBeNull();
  });

  it("keeps a queued change pending while the command waits for a connection", async () => {
    const resources = resourcesWith(multiProvider);
    const remoteThread = thread(
      { effort: "high", model: "sol", permissions: ":workspace" },
      codexAgent,
    );
    const onUpdateSettings = jest.fn(async () => new Promise<void>(() => undefined));
    const view = render(
      <Harness
        onUpdateSettings={onUpdateSettings}
        remoteThread={remoteThread}
        resources={resources}
      />,
    );
    await catalogLoaded(view, 1);
    await waitFor(() => {
      expect(accessLabel(view)).toHaveTextContent("Workspace");
    });
    await press(view, "Choose read only");
    view.rerender(
      <Harness
        onUpdateSettings={onUpdateSettings}
        remoteThread={remoteThread}
        resources={resources}
      />,
    );
    expect(accessLabel(view)).toHaveProp("accessibilityLabel", "Read only");
    expect(view.getByTestId("control-error")).toHaveTextContent("");
  });

  it("reverts a rejected change and shows the server's error", async () => {
    const resources = resourcesWith(multiProvider);
    const remoteThread = thread(
      { effort: "high", model: "sol", permissions: ":workspace" },
      codexAgent,
    );
    const update = deferred();
    const view = render(
      <Harness
        onUpdateSettings={async () => update.promise}
        remoteThread={remoteThread}
        resources={resources}
      />,
    );
    await catalogLoaded(view, 1);
    await waitFor(() => {
      expect(accessLabel(view)).toHaveTextContent("Workspace");
    });
    await press(view, "Choose full access");
    expect(accessLabel(view)).toHaveTextContent("Full access");
    await act(async () => {
      update.reject(new NativeCommandRejectedError("Full access is disabled on this server"));
      await update.promise.catch(() => undefined);
    });
    expect(accessLabel(view)).toHaveTextContent("Workspace");
    expect(view.getByTestId("control-error")).toHaveTextContent(
      "Full access is disabled on this server",
    );
  });

  it("shimmers a model change without changing its text until the server echoes it", async () => {
    const resources = resourcesWith(multiProvider);
    const remoteThread = thread(
      { effort: "medium", model: "sol", permissions: ":workspace" },
      codexAgent,
    );
    const onUpdateSettings = jest.fn(async () => undefined);
    const view = render(
      <Harness
        onUpdateSettings={onUpdateSettings}
        remoteThread={remoteThread}
        resources={resources}
      />,
    );
    await catalogLoaded(view, 1);
    expect(modelLabel(view)).toHaveTextContent("sol · Medium");
    await press(view, "Apply Sol high");
    expect(onUpdateSettings).toHaveBeenCalledWith({
      effort: "high",
      model: "sol",
      serviceTier: null,
    });
    expect(modelLabel(view)).toHaveTextContent("sol · High");
    expect(modelLabel(view)).not.toHaveTextContent("Updating");

    const echoed = thread({ effort: "high", model: "sol", permissions: ":workspace" }, codexAgent);
    view.rerender(
      <Harness onUpdateSettings={onUpdateSettings} remoteThread={echoed} resources={resources} />,
    );
    expect(modelLabel(view)).toHaveTextContent("sol · High");
    expect(modelLabel(view)).not.toHaveProp("accessibilityLabel");

    // A later change from another device is authoritative.
    const reverted = thread(
      { effort: "medium", model: "sol", permissions: ":workspace" },
      codexAgent,
    );
    view.rerender(
      <Harness onUpdateSettings={onUpdateSettings} remoteThread={reverted} resources={resources} />,
    );
    expect(modelLabel(view)).toHaveTextContent("sol · Medium");
  });

  it("accepts the server reporting Fast as priority", async () => {
    const resources = resourcesWith(multiProvider);
    const remoteThread = thread(
      { effort: "medium", model: "sol", permissions: ":workspace", serviceTier: "default" },
      codexAgent,
    );
    const view = render(
      <Harness
        onUpdateSettings={async () => new Promise<void>(() => undefined)}
        remoteThread={remoteThread}
        resources={resources}
      />,
    );
    await catalogLoaded(view, 1);
    await press(view, "Enable Fast");
    expect(modelLabel(view)).toHaveProp("accessibilityLabel", "sol · Medium");
    const echoed = thread(
      {
        effort: "medium",
        model: "sol",
        permissions: ":workspace",
        serviceTier: "priority",
      },
      codexAgent,
    );
    view.rerender(
      <Harness
        onUpdateSettings={async () => new Promise<void>(() => undefined)}
        remoteThread={echoed}
        resources={resources}
      />,
    );
    expect(modelLabel(view)).not.toHaveProp("accessibilityLabel");
  });

  it("sends the configured profile for Server default", async () => {
    const resources = resourcesWith(multiProvider);
    const remoteThread = thread(
      { effort: "high", model: "sol", permissions: ":workspace" },
      codexAgent,
    );
    const onUpdateSettings = jest.fn(async () => undefined);
    const view = render(
      <Harness
        onUpdateSettings={onUpdateSettings}
        remoteThread={remoteThread}
        resources={resources}
      />,
    );
    await catalogLoaded(view, 1);
    await waitFor(() => {
      expect(accessLabel(view)).toHaveTextContent("Workspace");
    });
    await press(view, "Choose server default");
    expect(onUpdateSettings).toHaveBeenCalledWith({ permissions: ":read-only" });
    expect(accessLabel(view)).toHaveTextContent("Read only");
  });
});

describe("Claude thread", () => {
  it("resets to the Companion's neutral default and hides effort for a model without levels", async () => {
    const resources = resourcesWith(multiProvider);
    const remoteThread = thread(
      { effort: "high", model: "opus", permissions: ":full-access" },
      claudeAgent,
    );
    const onUpdateSettings = jest.fn(async () => undefined);
    const view = render(
      <Harness
        onUpdateSettings={onUpdateSettings}
        remoteThread={remoteThread}
        resources={resources}
      />,
    );
    await catalogLoaded(view, 2);
    await waitFor(() => {
      expect(modelLabel(view)).toHaveTextContent("opus · High");
    });
    await press(view, "Choose server default");
    expect(onUpdateSettings).toHaveBeenLastCalledWith({ permissions: ":workspace" });

    await press(view, "Apply Haiku");
    expect(onUpdateSettings).toHaveBeenLastCalledWith({ model: "haiku", serviceTier: null });
    expect(view.getByTestId("menu-model")).toHaveTextContent("haiku/none");
    expect(modelLabel(view)).toHaveTextContent("haiku");
    expect(modelLabel(view)).not.toHaveTextContent("·");
    expect(view.getByTestId("menu-model")).toHaveTextContent("haiku/none");
  });

  it("marks a mid-turn read-only change as applying from the next turn", async () => {
    const resources = resourcesWith(multiProvider);
    const remoteThread = thread(
      { effort: "high", model: "opus", permissions: ":workspace" },
      claudeAgent,
      [runningTurn()],
    );
    const onUpdateSettings = jest.fn(async () => undefined);
    const view = render(
      <Harness
        onUpdateSettings={onUpdateSettings}
        remoteThread={remoteThread}
        resources={resources}
      />,
    );
    await catalogLoaded(view, 2);
    await waitFor(() => {
      expect(accessLabel(view)).toHaveTextContent("Workspace");
    });
    await press(view, "Choose full access");
    // Claude switches workspace and full access inside the running turn.
    expect(view.queryByTestId("composer-permissions-next-turn")).toBeNull();

    await press(view, "Choose read only");
    expect(view.getByTestId("composer-permissions-next-turn")).toBeTruthy();
    expect(view.getByLabelText("Permissions: Read only, applies from the next turn")).toBeTruthy();

    await press(view, "Apply Opus max");
    expect(view.getByTestId("composer-model-next-turn")).toBeTruthy();
    expect(modelLabel(view)).toHaveTextContent("opus · Max");
  });
});

describe("new chat", () => {
  it("shows the resolved default and keeps choices local until the first message", async () => {
    const resources = resourcesWith(multiProvider);
    const onUpdateSettings = jest.fn(async () => undefined);
    const view = render(
      <Harness newChat onUpdateSettings={undefined} remoteThread={null} resources={resources} />,
    );
    await catalogLoaded(view, 3);
    await waitFor(() => {
      expect(accessLabel(view)).toHaveTextContent("Read only");
    });
    expect(modelLabel(view)).toHaveTextContent("sol · Medium");
    expect(view.getByTestId("menu-permissions")).toHaveTextContent(
      'none|{"kind":"draft","resolved":":read-only","selected":true}',
    );
    await press(view, "Choose full access");
    expect(accessLabel(view)).toHaveTextContent("Full access");
    expect(accessLabel(view)).not.toHaveProp("accessibilityLabel");

    await press(view, "Apply Opus max");
    expect(modelLabel(view)).toHaveTextContent("opus · Max");
    await press(view, "Choose server default");
    // A Claude new chat starts with the Companion's neutral default.
    expect(accessLabel(view)).toHaveTextContent("Workspace");
    expect(onUpdateSettings).not.toHaveBeenCalled();
  });
});

describe("legacy single-provider server", () => {
  it("shows the legacy sandbox label and resets to the configured profile", async () => {
    const resources = resourcesWith(legacy);
    const remoteThread = thread({ effort: "medium", model: "sol", permissions: null }, null);
    const onUpdateSettings = jest.fn(async () => undefined);
    const view = render(
      <Harness
        onUpdateSettings={onUpdateSettings}
        remoteThread={remoteThread}
        resources={resources}
      />,
    );
    await catalogLoaded(view, 1);
    await waitFor(() => {
      expect(accessLabel(view)).toHaveTextContent("Workspace · Ask");
    });
    expect(modelLabel(view)).toHaveTextContent("sol · Medium");
    await press(view, "Choose server default");
    expect(onUpdateSettings).toHaveBeenCalledWith({ permissions: ":read-only" });
  });
});
