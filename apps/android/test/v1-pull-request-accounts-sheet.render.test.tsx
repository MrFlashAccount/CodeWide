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
import { AccountsSheet } from "../src/features/pullRequests/accounts/AccountsSheet";
import type { PullRequestsWorkspaceCapabilities } from "../src/features/pullRequests/workspaceCapabilities";
import {
  arcanumProvider,
  connectedAccount,
  githubProvider,
  onboardingAccounts,
} from "./fixtures/forgeWireFixtures";
import { invokeAppDialogAction, getAppDialogRequest, resetAppDialog } from "./mocks/AppDialog";

// WHY: the native sheet window cannot mount in the Node renderer; the sheet's content is the contract here.
jest.mock("../src/ui/AppSheet", () => {
  const { View: MockView } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    AppSheet: ({ children }: { readonly children: ReactNode }) => <MockView>{children}</MockView>,
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
      <AccountsSheet
        capabilities={workspaceCapabilities}
        connectionId="server"
        onDismiss={() => undefined}
        snapshot={snapshot}
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

it("lists each provider's accounts with an Add account row and no provider switch", () => {
  const view = renderSheet(POOL, capabilities());

  const github = within(view.getByTestId("forge-provider-group-github"));
  expect(github.getByText("GitHub")).toBeOnTheScreen();
  expect(github.getByText("@sergeigarin")).toBeOnTheScreen();
  expect(github.getByText("@reviewer")).toBeOnTheScreen();
  expect(github.getByRole("button", { name: "Add GitHub account" })).toBeOnTheScreen();
  // Account switches only: one per account, none for a provider.
  expect(view.UNSAFE_getAllByType(Switch)).toHaveLength(2);
  expect(view.queryByLabelText(/enabled$/u)).toBeNull();
  expect(accountSwitch(view, "sergeigarin").props.value).toBe(true);
  expect(accountSwitch(view, "reviewer").props.value).toBe(false);
  // Removal lives in the row menu, not as primary buttons.
  expect(view.queryByRole("button", { name: "Remove account" })).toBeNull();
  expect(view.queryByRole("button", { name: "Log out on host" })).toBeNull();
});

it("shows a missing plugin quietly without an Add account action", () => {
  const view = renderSheet(POOL, capabilities());

  const arcanum = within(view.getByTestId("forge-provider-group-arcanum"));
  expect(arcanum.getByText("Plugin not installed")).toBeOnTheScreen();
  expect(
    arcanum.getByText("The provider's plugin is not installed on the companion host"),
  ).toBeOnTheScreen();
  expect(arcanum.queryByRole("button", { name: "Add Arcanum account" })).toBeNull();
});

it("opens the provider's sign-in sheet from Add account", () => {
  const view = renderSheet(POOL, capabilities());

  expect(view.queryByTestId("forge-sign-in-sheet-github")).toBeNull();
  fireEvent.press(view.getByRole("button", { name: "Add GitHub account" }));

  const signIn = within(view.getByTestId("forge-sign-in-sheet-github"));
  expect(signIn.getByText("Add GitHub account")).toBeOnTheScreen();
  expect(signIn.getByText("Sign in with GitHub")).toBeOnTheScreen();
  expect(signIn.getByText("Paste a token")).toBeOnTheScreen();
});

it("treats a provider disabled in the registry like any other provider", () => {
  const disabled = snapshotOf({
    ...onboardingAccounts,
    accounts: [{ ...connectedAccount, catalogEnabled: true }],
    providers: [{ ...githubProvider, enabled: false, installation: { state: "installed" } }],
  });
  const view = renderSheet(disabled, capabilities());

  const github = within(view.getByTestId("forge-provider-group-github"));
  expect(github.getByText("@sergeigarin")).toBeOnTheScreen();
  expect(view.UNSAFE_getAllByType(Switch)).toHaveLength(1);
  fireEvent.press(github.getByRole("button", { name: "Add GitHub account" }));
  expect(view.getByTestId("forge-sign-in-sheet-github")).toBeOnTheScreen();
});

it("calls the account switch, holds the requested value while pending and restores it on failure", async () => {
  const request = deferred<AccountState>();
  const setAccountEnabled = jest.fn(
    (_connectionId: string, _account: ForgeAccountKey, _enabled: boolean) => request.promise,
  );
  const view = renderSheet(POOL, capabilities({ setAccountEnabled }));
  act(() => {
    accountSwitch(view, "sergeigarin").props.onValueChange(false);
  });

  expect(setAccountEnabled).toHaveBeenCalledWith("server", connectedAccount.account, false);
  expect(accountSwitch(view, "sergeigarin").props).toMatchObject({ disabled: true, value: false });
  expect(view.getByText("@sergeigarin")).toBeOnTheScreen();

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
