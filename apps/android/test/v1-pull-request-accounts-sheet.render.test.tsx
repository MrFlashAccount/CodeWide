import { act, fireEvent, render, within } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Switch } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  parseForgeAccounts,
  type AccountState,
  type ForgeAccountKey,
  type ForgeAccountsSnapshot,
} from "../src/data/forgeContract";
import { ConnectionForgeAccounts } from "../src/features/pullRequests/accounts/ConnectionForgeAccounts";
import { SettingsSheet } from "../src/features/settings/SettingsSheet";
import type { PullRequestsWorkspaceCapabilities } from "../src/features/pullRequests/workspaceCapabilities";
import {
  arcanumProvider,
  connectedAccount,
  githubProvider,
  hostLoginFlow,
  onboardingAccounts,
} from "./fixtures/forgeWireFixtures";
import { invokeAppDialogAction, getAppDialogRequest, resetAppDialog } from "./mocks/AppDialog";

// WHY: the native sheet window cannot mount in the Node renderer; the sheet's content is the contract here.
jest.mock("../src/ui/AppSheet", () => {
  const { View: MockView } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    AppSheet: ({ children }: { readonly children: ReactNode }) => (
      <MockView testID="native-sheet-window">{children}</MockView>
    ),
    AppSheetScrollView: ({
      children,
      testID,
    }: {
      readonly children: ReactNode;
      readonly testID?: string;
    }) => <MockView testID={testID}>{children}</MockView>,
  };
});

const secondAccount = {
  ...connectedAccount,
  account: "github:github.com:reviewer",
  catalogEnabled: false,
  login: "reviewer",
};
const POOL = snapshotOf({
  ...onboardingAccounts,
  accounts: [{ ...connectedAccount, catalogEnabled: true }, secondAccount],
  providers: [
    { ...githubProvider, installation: { state: "installed" } },
    {
      ...arcanumProvider,
      installation: {
        reason: "The provider's plugin is not installed on the companion host",
        state: "missing",
      },
    },
  ],
});

afterEach(() => {
  resetAppDialog();
});

function snapshotOf(value: unknown): ForgeAccountsSnapshot {
  const snapshot = parseForgeAccounts(value);
  if (snapshot === null) {
    throw new Error("The accounts sheet fixture is invalid");
  }
  return snapshot;
}

function capabilities(
  overrides: Partial<PullRequestsWorkspaceCapabilities> = {},
): PullRequestsWorkspaceCapabilities {
  return {
    cancelAuth: () => Promise.resolve(),
    checkAgain: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    setAccountEnabled: () => Promise.reject(new Error("Not used by this test")),
    startAuth: () => Promise.reject(new Error("Not used by this test")),
    submitToken: () => Promise.reject(new Error("Not used by this test")),
    ...overrides,
  };
}

function renderSheet(
  snapshot: ForgeAccountsSnapshot,
  workspaceCapabilities: PullRequestsWorkspaceCapabilities,
): ReturnType<typeof render> {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 800, width: 400, x: 0, y: 0 },
        insets: { bottom: 0, left: 0, right: 0, top: 0 },
      }}
    >
      <SettingsSheet
        advanced={null}
        chats={null}
        downloads={null}
        security={null}
        servers={[]}
        version={null}
        entryPage="pullRequests"
        onAddServer={() => undefined}
        onClose={() => undefined}
        visible
        voiceAssistant={{ content: null, description: "", onOpen: () => undefined }}
        renderPullRequests={(page) => (
          <ConnectionForgeAccounts
            capabilities={workspaceCapabilities}
            connectionId="server"
            page={page}
            serverName="Workstation"
            snapshot={snapshot}
          />
        )}
      />
    </SafeAreaProvider>,
  );
}

/** The account switch by its accessible name; the Node Android switch host does not expose its value. */
function accountSwitch(view: ReturnType<typeof render>, login: string) {
  const name = `Show pull requests from @${login}`;
  const found = view
    .UNSAFE_getAllByType(Switch)
    .find((candidate) => candidate.props.accessibilityLabel === name);
  if (found === undefined) {
    throw new Error(`No switch named ${name}`);
  }
  return found;
}

function deferred<Value>(): {
  readonly promise: Promise<Value>;
  readonly reject: (error: Error) => void;
  readonly resolve: (value: Value) => void;
} {
  let resolve: (value: Value) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}

it("lists accounts from different providers together and offers Add account once", () => {
  const mixed = snapshotOf({
    ...onboardingAccounts,
    accounts: [
      connectedAccount,
      {
        ...connectedAccount,
        account: "arc-review",
        login: "arc-review",
        host: arcanumProvider.defaultHost,
        pluginId: arcanumProvider.pluginId,
      },
      secondAccount,
    ],
  });
  const view = renderSheet(mixed, capabilities());
  const buttons = view.getAllByRole("button").map((button) => button.props.accessibilityLabel);
  expect(buttons).toEqual([
    "Back to settings",
    "@sergeigarin, github.com",
    `@arc-review, ${arcanumProvider.defaultHost}`,
    "@reviewer, github.com",
    "Add account",
  ]);
  expect(
    within(view.getByTestId("forge-account-arc-review")).getByText(
      `Arcanum · ${arcanumProvider.defaultHost}`,
    ),
  ).toBeOnTheScreen();
  expect(view.UNSAFE_queryAllByType(Switch)).toHaveLength(0);
  fireEvent.press(view.getByRole("button", { name: "@reviewer, github.com" }));
  expect(accountSwitch(view, "reviewer").props.value).toBe(false);
  expect(view.getAllByTestId("native-sheet-window")).toHaveLength(1);
  expect(view.getByRole("header", { name: "@reviewer" })).toBeOnTheScreen();
  expect(view.queryByText("Add account")).toBeNull();
  fireEvent.press(view.getByRole("button", { name: "Back to pull requests" }));
  expect(view.getByRole("header", { name: "Pull requests" })).toBeOnTheScreen();
  expect(view.getByRole("button", { name: "Add account" })).toBeOnTheScreen();
});

it("explains a missing plugin in the shared chooser and keeps it unavailable for sign-in", () => {
  const view = renderSheet(POOL, capabilities());
  fireEvent.press(view.getByRole("button", { name: "Add account" }));
  expect(view.getByRole("button", { name: "Arcanum" })).toBeDisabled();
  expect(
    view.getByText(/Plugin not installed.*not installed on the companion host/),
  ).toBeOnTheScreen();
  expect(view.getByRole("button", { name: "GitHub" })).toBeEnabled();
});

it("keeps the provider choice even on an empty single-provider server and returns to settings after sign-in", async () => {
  const empty = snapshotOf({ ...onboardingAccounts, accounts: [], providers: [githubProvider] });
  const linked = POOL.accounts[0];
  const startAuth = jest.fn(async () => ({ kind: "connected" as const, account: linked }));
  const view = renderSheet(empty, capabilities({ startAuth }));
  fireEvent.press(view.getByRole("button", { name: "Add account" }));
  fireEvent.press(view.getByRole("button", { name: "GitHub" }));
  fireEvent.press(view.getByRole("button", { name: "Back" }));
  fireEvent.press(view.getByRole("button", { name: "GitHub" }));
  await act(async () => {
    fireEvent.press(view.getByRole("button", { name: "Use @sergeigarin" }));
  });
  expect(startAuth).toHaveBeenCalledWith("server", {
    host: "github.com",
    login: "sergeigarin",
    methodId: "gh-link",
    pluginId: "github",
  });
  expect(view.queryByRole("button", { name: "Use @sergeigarin" })).toBeNull();
  expect(view.queryByRole("header", { name: "Add account" })).toBeNull();
  expect(view.getByRole("button", { name: "Add account" })).toBeOnTheScreen();
});

it("keeps the three sign-in steps and their Back history inside the original settings sheet", () => {
  const view = renderSheet(POOL, capabilities());
  const sheet = view.getByTestId("native-sheet-window");
  fireEvent.press(view.getByRole("button", { name: "Add account" }));
  expect(within(sheet).getByRole("header", { name: "Connect a provider" })).toBeOnTheScreen();
  fireEvent.press(within(sheet).getByRole("button", { name: "GitHub" }));
  fireEvent.press(within(sheet).getByRole("button", { name: "Paste a token" }));
  expect(within(sheet).getByText("Save token")).toBeOnTheScreen();
  expect(view.queryByTestId("tray-backdrop")).toBeNull();
  fireEvent.press(within(sheet).getByRole("button", { name: "Back" }));
  expect(within(sheet).queryByText("Save token")).toBeNull();
  fireEvent.press(within(sheet).getByRole("button", { name: "Back" }));
  fireEvent.press(within(sheet).getByRole("button", { name: "Back to pull requests" }));
  expect(within(sheet).getByRole("button", { name: "Add account" })).toBeOnTheScreen();
});

it("resumes a pending host sign-in when that provider is selected", () => {
  const pending = snapshotOf({ ...onboardingAccounts, flows: [hostLoginFlow] });
  const view = renderSheet(pending, capabilities());
  fireEvent.press(view.getByRole("button", { name: "Add account" }));
  fireEvent.press(view.getByRole("button", { name: "GitHub" }));
  expect(view.getByText(hostLoginFlow.userCode)).toBeOnTheScreen();
});

it("keeps accounts and sign-in available for a provider disabled in the registry", () => {
  const disabled = snapshotOf({
    ...onboardingAccounts,
    accounts: [{ ...connectedAccount, catalogEnabled: true }],
    providers: [{ ...githubProvider, enabled: false, installation: { state: "installed" } }],
  });
  const view = renderSheet(disabled, capabilities());
  expect(view.getByText("@sergeigarin")).toBeOnTheScreen();
  fireEvent.press(view.getByRole("button", { name: "Add account" }));
  fireEvent.press(view.getByRole("button", { name: "GitHub" }));
  expect(view.getByRole("button", { name: "Sign in with GitHub" })).toBeOnTheScreen();
});

it("calls the account switch, holds the requested value while pending and restores it on failure", async () => {
  const request = deferred<AccountState>();
  const setAccountEnabled = jest.fn(
    (_connectionId: string, _account: ForgeAccountKey, _enabled: boolean) => request.promise,
  );
  const view = renderSheet(POOL, capabilities({ setAccountEnabled }));
  fireEvent.press(view.getByRole("button", { name: "@sergeigarin, github.com" }));
  act(() => {
    accountSwitch(view, "sergeigarin").props.onValueChange(false);
  });

  expect(setAccountEnabled).toHaveBeenCalledWith("server", connectedAccount.account, false);
  expect(accountSwitch(view, "sergeigarin").props).toMatchObject({ disabled: true, value: false });
  expect(view.getByRole("header", { name: "@sergeigarin" })).toBeOnTheScreen();

  await act(async () => {
    request.reject(new Error("The companion refused the change"));
    await request.promise.catch(() => undefined);
  });

  expect(accountSwitch(view, "sergeigarin").props).toMatchObject({ disabled: false, value: true });
  expect(view.getByText("The companion refused the change")).toBeOnTheScreen();
});

it("removes an account from the row menu and confirms a host logout", async () => {
  const disconnect = jest.fn(() => Promise.resolve());
  const view = renderSheet(POOL, capabilities({ disconnect }));

  fireEvent.press(view.getByRole("button", { name: "@sergeigarin, github.com" }));
  fireEvent.press(view.getByLabelText("Actions for @sergeigarin"));
  fireEvent.press(view.getByLabelText("Actions for @sergeigarin: Remove account"));
  await act(async () => {
    await Promise.resolve();
  });
  expect(disconnect).toHaveBeenCalledWith("server", {
    account: connectedAccount.account,
    confirmation: "none",
    mode: "unlink",
  });

  fireEvent.press(view.getByRole("button", { name: "@sergeigarin, github.com" }));
  fireEvent.press(view.getByLabelText("Actions for @sergeigarin"));
  fireEvent.press(view.getByLabelText("Actions for @sergeigarin: Log out on host"));
  expect(getAppDialogRequest()?.title).toBe("Log out @sergeigarin on github.com?");
  expect(disconnect).toHaveBeenCalledTimes(1);
  await act(async () => {
    invokeAppDialogAction("Log out");
    await Promise.resolve();
  });
  expect(disconnect).toHaveBeenLastCalledWith("server", {
    account: connectedAccount.account,
    confirmation: "destructive",
    mode: "logoutHost",
  });
});
